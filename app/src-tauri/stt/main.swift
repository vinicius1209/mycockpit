// mycockpit-stt: sidecar de ditado ON-DEVICE (pt-BR) do MyCockpit.
// O cockpit fala com ele igual fala com os agents: spawn + JSON por linha.
//
//   stdin:  "STOP"   → encerra o áudio e devolve o texto final
//           "CANCEL" → descarta e sai
//           EOF      → app morreu, sai (não vira órfão)
//   stdout: {"ready":true,"deviceUid":"…","deviceName":"…"} → gravando
//           {"partial":"…"} → transcrição parcial (ao vivo, texto COMPLETO)
//           {"level":0.0}   → nível real da entrada, normalizado em 0...1
//           {"captureLost":"…"} → captura interrompida; o áudio será finalizado
//           {"warn":"…"}    → aviso honesto antes do final (ex.: caiu no streaming)
//           {"text":"…"}    → texto final
//           {"error":"…"}   → falha (permissão, mic, locale)
//
// A vantagem sobre ditado genérico: --vocab injeta os TERMOS DO PROJETO
// (contextualStrings) no reconhecedor. Pontuação automática (macOS 13+).
// Permissões: o Info.plist embutido via sectcreate (ver build.rs) faz o TCC
// aceitar um binário de linha de comando.
//
// DITADO CONTÍNUO: o SFSpeechRecognizer encerra/reseta a utterance após pausas
// na fala (isFinal ou reset silencioso do parcial). Guardar só o último parcial
// descartava tudo antes da última pausa ("só as últimas palavras"). O padrão
// canônico: ACUMULAR utterances finalizadas em `committed` e REINICIAR um task
// novo — a gravação segue até o STOP, nunca morre numa pausa.
//
// ── AS DUAS REGRAS QUE IMPEDEM DE "COMER O FIM DA FRASE" ────────────────────
//
// 1) O FINAL NUNCA ENCURTA (`moreComplete`, pura e coberta por --selftest).
//    O resultado final do streaming PODE vir mais curto que o parcial que o
//    usuário acabou de ver (o reconhecedor reavalia e às vezes descarta o rabo
//    da frase). Guardamos `bestCurrent` = o texto MAIS COMPLETO já visto na
//    utterance corrente e, em todo desfecho, entregamos o mais completo entre o
//    candidato e o melhor visto: quem ESTENDE/contém vence; quem é PEDAÇO do
//    outro perde; se divergiram, vence quem tem mais palavras. Empate normalizado
//    (só pontuação/acento/caixa mudou) fica com o candidato, que é o mais bem
//    formatado. Nenhuma heurística de "metade do tamanho" decide o final.
//
// 2) A VERDADE VEM DO ARQUIVO, o streaming é PREVIEW.
//    Toda a sessão é gravada num CAF temporário (mesmo callback da captura) e o
//    STOP roda uma passada `SFSpeechURLRecognitionRequest` sobre o arquivo
//    INTEIRO (on-device, mesma stack). É impossível o arquivo perder o fim: ele
//    tem o áudio todo. Se essa passada falhar ou estourar o prazo, cai no texto
//    do streaming (regra 1) com {"warn"} — nunca se perde a fala. O arquivo é
//    apagado em TODO desfecho (sucesso, erro, cancel, atexit) e sobras antigas
//    de um kill -9 são varridas no boot.
//
// Ordem do STOP (o que fazia o fim sumir): o código antigo parava a captura
// ANTES do endAudio — o áudio em voo morria no caminho. Agora:
// drain curto com o mic AINDA aberto (os últimos buffers chegam ao request) →
// endAudio() → captureSession.stopRunning() → passada de arquivo.

import AVFoundation
import CoreMedia
import Foundation
import Speech

let emitLock = NSLock()
func emit(_ obj: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: obj),
          let s = String(data: d, encoding: .utf8) else { return }
    emitLock.lock()
    print(s)
    fflush(stdout)
    emitLock.unlock()
}

// ---- REGRA 1, pura: "o final nunca encurta" ────────────────────────────────

/// Normaliza pra COMPARAR (não pra exibir): sem acento, sem caixa, sem
/// pontuação, espaços colapsados. Assim "Olá, tudo bem?" e "ola tudo bem" são
/// a mesma fala — pontuação nova não conta como texto novo, nem como perda.
func normalizedForCompare(_ s: String) -> String {
    let folded = s.folding(
        options: [.diacriticInsensitive, .caseInsensitive, .widthInsensitive],
        locale: Locale(identifier: "pt_BR"))
    var out = ""
    out.reserveCapacity(folded.count)
    for u in folded.unicodeScalars {
        out.append(CharacterSet.alphanumerics.contains(u) ? Character(u) : " ")
    }
    return out.split(separator: " ").joined(separator: " ")
}

/// Palavras do texto normalizado (medida de "quanta fala tem aqui").
func wordCount(_ normalized: String) -> Int {
    normalized.isEmpty ? 0 : normalized.split(separator: " ").count
}

/// `a` contém `b` em fronteira de PALAVRA (ambos já normalizados).
func containsWords(_ a: String, _ b: String) -> Bool {
    if b.isEmpty { return true }
    return " \(a) ".contains(" \(b) ")
}

/// REGRA 1: devolve o MAIS COMPLETO entre `candidate` (texto novo/final) e
/// `best` (o melhor já visto). Nunca devolve um pedaço quando existe o todo.
func moreComplete(_ candidate: String, _ best: String) -> String {
    let c = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
    let b = best.trimmingCharacters(in: .whitespacesAndNewlines)
    if c.isEmpty { return b }
    if b.isEmpty { return c }
    let nc = normalizedForCompare(c)
    let nb = normalizedForCompare(b)
    if nc == nb { return c }              // mesma fala: fica a versão nova (melhor formatada)
    if containsWords(nc, nb) { return c } // o novo ESTENDE/contém o melhor
    if containsWords(nb, nc) { return b } // o novo é um PEDAÇO do melhor
    return wordCount(nc) >= wordCount(nb) ? c : b // divergiram: quem tem mais fala
}

/// Converte RMS em um medidor perceptual: -60 dB é silêncio visual, 0 dB é o
/// teto. O valor continua vindo do áudio real, sem animação inventada.
func meterLevel(forRms rms: Float) -> Double {
    guard rms.isFinite, rms > 0 else { return 0 }
    let decibels = 20 * log10(Double(rms))
    return min(1, max(0, (decibels + 60) / 60))
}

/// RMS normalizado do buffer, independente de Float32/Int16 e de interleaving.
/// Bluetooth HFP costuma chegar em Int16; o microfone interno, em Float32.
func rmsAmplitude(_ buffer: AVAudioPCMBuffer) -> Float {
    var squareSum = 0.0
    var sampleCount = 0
    for audioBuffer in UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList) {
        guard let raw = audioBuffer.mData else { continue }
        switch buffer.format.commonFormat {
        case .pcmFormatFloat32:
            let count = Int(audioBuffer.mDataByteSize) / MemoryLayout<Float>.size
            let samples = raw.bindMemory(to: Float.self, capacity: count)
            for i in 0..<count {
                let sample = Double(samples[i])
                squareSum += sample * sample
            }
            sampleCount += count
        case .pcmFormatFloat64:
            let count = Int(audioBuffer.mDataByteSize) / MemoryLayout<Double>.size
            let samples = raw.bindMemory(to: Double.self, capacity: count)
            for i in 0..<count {
                squareSum += samples[i] * samples[i]
            }
            sampleCount += count
        case .pcmFormatInt16:
            let count = Int(audioBuffer.mDataByteSize) / MemoryLayout<Int16>.size
            let samples = raw.bindMemory(to: Int16.self, capacity: count)
            for i in 0..<count {
                let sample = Double(samples[i]) / Double(Int16.max)
                squareSum += sample * sample
            }
            sampleCount += count
        case .pcmFormatInt32:
            let count = Int(audioBuffer.mDataByteSize) / MemoryLayout<Int32>.size
            let samples = raw.bindMemory(to: Int32.self, capacity: count)
            for i in 0..<count {
                let sample = Double(samples[i]) / Double(Int32.max)
                squareSum += sample * sample
            }
            sampleCount += count
        default:
            continue
        }
    }
    guard sampleCount > 0 else { return 0 }
    return Float(sqrt(squareSum / Double(sampleCount)))
}

// ---- args: --vocab "termo1,termo2" · --selfcheck (diagnóstico sem gravar)
//            --selftest (regra 1 em teste puro, sem mic nem permissão)
var vocab: [String] = []
var selfcheck = false
var selftest = false
/// UID do microfone escolhido nas Configurações. nil = o padrão do sistema,
/// que era o ÚNICO comportamento possível antes disto.
var deviceUID: String? = nil
var listDevices = false
var args = Array(CommandLine.arguments.dropFirst())
while !args.isEmpty {
    let a = args.removeFirst()
    if a == "--vocab", !args.isEmpty {
        vocab = args.removeFirst()
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    } else if a == "--selfcheck" {
        selfcheck = true
    } else if a == "--selftest" {
        selftest = true
    } else if a == "--device", !args.isEmpty {
        let v = args.removeFirst().trimmingCharacters(in: .whitespaces)
        deviceUID = v.isEmpty ? nil : v
    } else if a == "--list-devices" {
        listDevices = true
    }
}

/// Teste puro da REGRA 1, embutido no próprio binário: o projeto não tem
/// harness Swift (o sidecar é um único arquivo compilado pelo build.rs), então
/// a suíte vive aqui e é executada pelo `cargo test` (stt.rs) rodando
/// `mycockpit-stt --selftest`. Sai 0 se tudo passa; imprime cada falha.
func runSelfTest() -> Int32 {
    // (nome, candidato, melhor visto, esperado)
    let cases: [(String, String, String, String)] = [
        ("final que COMEU o rabo perde pro melhor parcial",
         "quero refatorar o watchdog",
         "quero refatorar o watchdog e rodar os testes antes do commit",
         "quero refatorar o watchdog e rodar os testes antes do commit"),
        ("final que ESTENDE o parcial vence",
         "quero refatorar o watchdog e rodar os testes",
         "quero refatorar o watchdog",
         "quero refatorar o watchdog e rodar os testes"),
        ("perda de 25% (a heurística da metade deixava passar) perde",
         "abre o painel de custo e confere",
         "abre o painel de custo e confere o total do mês passado",
         "abre o painel de custo e confere o total do mês passado"),
        ("só pontuação/caixa/acento muda: fica a versão nova",
         "Olá, tudo bem com você hoje?",
         "ola tudo bem com voce hoje",
         "Olá, tudo bem com você hoje?"),
        ("textos que divergiram: vence quem tem mais palavras",
         "um dois tres quatro cinco",
         "um dois tres seis",
         "um dois tres quatro cinco"),
        ("divergiram e o melhor tem mais palavras: o melhor fica",
         "um dois tres",
         "um dois quatro cinco seis",
         "um dois quatro cinco seis"),
        ("candidato vazio devolve o melhor",
         "   ", "o que eu disse", "o que eu disse"),
        ("melhor vazio devolve o candidato",
         "o que eu disse", "", "o que eu disse"),
        ("ambos vazios devolve vazio", "", "", ""),
        ("prefixo de palavra não conta como contido",
         "tarefa", "tarefas do dia", "tarefas do dia"),
    ]
    var failures = 0
    for (name, candidate, best, want) in cases {
        let got = moreComplete(candidate, best)
        if got != want {
            failures += 1
            emit(["selftest": name, "want": want, "got": got])
        }
    }
    let levelCases: [(String, Float, ClosedRange<Double>)] = [
        ("silêncio fica no zero", 0, 0...0),
        ("-30 dB ocupa o meio do medidor", 0.031_622_78, 0.49...0.51),
        ("amplitude máxima chega ao teto", 1, 1...1),
        ("amplitude acima do teto é limitada", 2, 1...1),
    ]
    for (name, rms, expected) in levelCases {
        let got = meterLevel(forRms: rms)
        if !expected.contains(got) {
            failures += 1
            emit(["selftest": name, "want": "\(expected)", "got": got])
        }
    }
    emit([
        "selftest": "moreComplete+meterLevel",
        "cases": cases.count + levelCases.count,
        "failures": failures,
    ])
    return failures == 0 ? 0 : 1
}

// ---- AVFoundation: enumerar e ESCOLHER o microfone ────────────────────────
//
// A descoberta retorna só devices de ÁUDIO/ENTRADA e preserva o mesmo uniqueID
// estável do CoreAudio já salvo pela preferência. A captura por AVCaptureDevice
// é o que isola essa escolha da rota de saída Bluetooth do macOS.

struct MicDevice {
    let uid: String
    let name: String
}

func inputDevices() -> [MicDevice] {
    AVCaptureDevice.DiscoverySession(
        deviceTypes: [.microphone],
        mediaType: .audio,
        position: .unspecified
    ).devices.compactMap { device in
        guard device.isConnected else { return nil }
        return MicDevice(uid: device.uniqueID, name: device.localizedName)
    }
}

if listDevices {
    emit(["devices": inputDevices().map { ["uid": $0.uid, "name": $0.name] }])
    exit(0)
}

if selftest {
    exit(runSelfTest())
}

guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "pt-BR")) else {
    emit(["error": "reconhecedor pt-BR indisponível neste macOS"])
    exit(1)
}

if selfcheck {
    emit([
        "locale": "pt-BR",
        "available": recognizer.isAvailable,
        "onDevice": recognizer.supportsOnDeviceRecognition,
    ])
    exit(0)
}

// A promessa da interface é 100% local. Se este Mac/locale não suportar o
// reconhecedor on-device, aborta em vez de permitir fallback de rede.
guard recognizer.supportsOnDeviceRecognition else {
    emit(["error": "o reconhecimento local em Português (Brasil) não está disponível neste Mac. Ative o Ditado e baixe o idioma em Ajustes do Sistema → Teclado → Ditado."])
    exit(1)
}

// ---- REGRA 2 (parte 1): arquivo temporário da sessão ───────────────────────

/// Prefixo dos arquivos de sessão (usado também na varredura de sobras).
let audioPrefix = "mycockpit-stt-"
let audioURL = FileManager.default.temporaryDirectory
    .appendingPathComponent("\(audioPrefix)\(UUID().uuidString).caf")

/// Apaga o áudio da sessão. Chamada em TODO desfecho e no atexit — o áudio da
/// fala do usuário não sobrevive à sessão que o gerou.
func removeAudioFile() {
    try? FileManager.default.removeItem(at: audioURL)
}
atexit { removeAudioFile() }

/// Varre sobras de sessões mortas a `kill -9` (o Rust mata o sidecar no cancel:
/// SIGKILL não roda atexit). Best-effort e silencioso de propósito: ninguém
/// espera resultado daqui, e falhar a varredura não pode impedir um ditado.
func sweepStaleAudio() {
    let fm = FileManager.default
    guard let items = try? fm.contentsOfDirectory(
        at: fm.temporaryDirectory,
        includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
    let cutoff = Date().addingTimeInterval(-3600)
    for u in items where u.lastPathComponent.hasPrefix(audioPrefix) {
        let d = try? u.resourceValues(forKeys: [.contentModificationDateKey])
            .contentModificationDate
        if let d, d < cutoff { try? fm.removeItem(at: u) }
    }
}
sweepStaleAudio()

// ---- permissões (fala + microfone); podem abrir diálogo na primeira vez.
let authSem = DispatchSemaphore(value: 0)
var speechOK = false
SFSpeechRecognizer.requestAuthorization { st in
    speechOK = st == .authorized
    authSem.signal()
}
authSem.wait()
guard speechOK else {
    emit(["error": "permissão de Reconhecimento de Fala negada (Ajustes → Privacidade e Segurança)"])
    exit(1)
}
let micSem = DispatchSemaphore(value: 0)
var micOK = false
AVCaptureDevice.requestAccess(for: .audio) { ok in
    micOK = ok
    micSem.signal()
}
micSem.wait()
guard micOK else {
    emit(["error": "permissão de Microfone negada (Ajustes → Privacidade e Segurança)"])
    exit(1)
}

// ---- o reconhecedor pode levar um instante pra ficar disponível (conecta ao
// serviço / verifica o asset on-device). Sem essa espera o task falha na hora.
var availableWait = 0
while !recognizer.isAvailable && availableWait < 50 {
    Thread.sleep(forTimeInterval: 0.1)
    availableWait += 1
}
guard recognizer.isAvailable else {
    emit(["error": "reconhecedor pt-BR indisponível agora (o modelo on-device pode estar baixando — tente de novo em instantes)"])
    exit(1)
}

// ---- estado do ditado contínuo (protegido por lock: callbacks do Speech +
// thread de áudio + thread do stdin tocam nele).
let stateLock = NSLock()
var committed = ""    // utterances já finalizadas (o que NÃO pode mais se perder)
var current = ""      // último parcial da utterance corrente (o que a UI vê)
var bestCurrent = ""  // REGRA 1: o texto mais COMPLETO já visto nesta utterance
var stopped = false   // STOP recebido: quem conclui é o pipeline do STOP
var finished = false  // resposta final já emitida (once)
var activeRequest: SFSpeechAudioBufferRecognitionRequest?
var activeTask: SFSpeechRecognitionTask?

/// Sinaliza que o task de streaming concluiu DEPOIS do STOP (isFinal ou erro):
/// o pipeline do STOP espera um pouco por ele antes da passada de arquivo, pra
/// o texto de fallback já ser o melhor possível.
let streamingDone = DispatchSemaphore(value: 0)
var streamingSignaled = false
func signalStreamingDone() { // chamar com o stateLock TRAVADO
    if streamingSignaled { return }
    streamingSignaled = true
    streamingDone.signal()
}

@Sendable func joined(_ a: String, _ b: String) -> String {
    if a.isEmpty { return b }
    if b.isEmpty { return a }
    return a + " " + b
}

/// O melhor texto que o STREAMING conseguiu até agora (regra 1 aplicada à
/// utterance corrente). É o fallback quando a passada de arquivo não entrega.
func streamedText() -> String { // chamar com o stateLock TRAVADO
    joined(committed, moreComplete(current, bestCurrent))
}

func finish(_ text: String, warn: String? = nil) {
    stateLock.lock()
    if finished {
        stateLock.unlock()
        return
    }
    finished = true
    stateLock.unlock()
    if let warn { emit(["warn": warn]) }
    emit(["text": text])
    removeAudioFile()
    exit(0)
}

func makeRequest() -> SFSpeechAudioBufferRecognitionRequest {
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.requiresOnDeviceRecognition = true
    if #available(macOS 13.0, *) {
        request.addsPunctuation = true
    }
    if !vocab.isEmpty {
        request.contextualStrings = vocab
    }
    return request
}

/// Inicia (ou REINICIA, após uma utterance fechar) um task de reconhecimento.
func startUtterance() {
    let request = makeRequest()
    stateLock.lock()
    activeRequest = request
    stateLock.unlock()
    activeTask = recognizer.recognitionTask(with: request) { result, err in
        stateLock.lock()
        // callback de um task já substituído pelo restart → ignora (stale)
        guard request === activeRequest else {
            stateLock.unlock()
            return
        }
        if let r = result {
            let t = r.bestTranscription.formattedString
            // reset SILENCIOSO (sem isFinal): o parcial encolhe drasticamente →
            // o reconhecedor recomeçou a utterance; commita o MELHOR visto (não
            // o último parcial) e abre uma utterance nova. Isto NÃO é a guarda
            // contra final curto (essa é a regra 1, no moreComplete): é a
            // detecção de que o reconhecedor jogou a utterance fora.
            if !bestCurrent.isEmpty && bestCurrent.count > 20
                && t.count * 2 < bestCurrent.count && !bestCurrent.hasPrefix(t) {
                committed = joined(committed, bestCurrent)
                bestCurrent = ""
            }
            current = t
            bestCurrent = moreComplete(t, bestCurrent)
            if r.isFinal {
                // utterance fechou (pausa na fala / limite do serviço): commita o
                // MAIS COMPLETO entre o final e o melhor parcial (regra 1) e, se
                // ainda gravando, REINICIA — o ditado continua.
                committed = joined(committed, moreComplete(t, bestCurrent))
                current = ""
                bestCurrent = ""
                let wasStopped = stopped
                if wasStopped { signalStreamingDone() }
                stateLock.unlock()
                // depois do STOP quem conclui é o pipeline do STOP (passada de
                // arquivo); aqui só deixamos o fallback no melhor estado.
                if !wasStopped { startUtterance() }
                return
            }
            let full = joined(committed, current)
            stateLock.unlock()
            emit(["partial": full])
            return
        }
        if let e = err as NSError? {
            committed = streamedText()
            current = ""
            bestCurrent = ""
            let wasStopped = stopped
            if wasStopped { signalStreamingDone() }
            let full = committed
            stateLock.unlock()
            // depois do STOP, o desfecho é do pipeline do STOP (que já tem o
            // texto acumulado como fallback) — nada a fazer aqui.
            if wasStopped { return }
            // silêncio / fim de utterance NO MEIO da gravação → reinicia (o
            // usuário segue com o mic aberto; matar a sessão aqui perdia fala).
            if e.domain == "kAFAssistantErrorDomain" && (e.code == 1110 || e.code == 203) {
                startUtterance()
                return
            }
            // Ditado do sistema desligado: aponta o caminho exato do Ajuste.
            if e.domain == "kLSRErrorDomain" && e.code == 201 {
                emit(["error": "ative o Ditado do macOS: Ajustes do Sistema → Teclado → Ditado (ligar). Baixe o pacote Português (Brasil)."])
                removeAudioFile()
                exit(1)
            }
            // falha real: se já há texto acumulado, entrega em vez de perder.
            if !full.isEmpty {
                finish(full)
                return
            }
            emit(["error": "o reconhecimento falhou: \(e.localizedDescription) [\(e.domain) \(e.code)]"])
            removeAudioFile()
            exit(1)
        } else {
            stateLock.unlock()
        }
    }
}

// ---- microfone → buffers → reconhecedor CORRENTE (o request troca no restart)
// E → arquivo da sessão (regra 2: a verdade vem do arquivo).
//
// `AVAudioEngine.inputNode` nasce sobre `CADefaultDeviceAggregate`: no macOS 26,
// a captura pode continuar presa à SAÍDA Bluetooth mesmo depois de a audio unit
// aceitar outro `CurrentDevice`. A UI então mostra o microfone interno enquanto
// o tap entrega silêncio. `AVCaptureSession` abre um AVCaptureDevice de entrada
// explícito e não possui rota de saída, portanto o fone deixa de participar da
// decisão. O uniqueID é o mesmo UID estável já persistido pela configuração.
final class MicrophoneSink: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
    let receive: (CMSampleBuffer) -> Void

    init(receive: @escaping (CMSampleBuffer) -> Void) {
        self.receive = receive
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        receive(sampleBuffer)
    }
}

func pcmBuffer(from sampleBuffer: CMSampleBuffer) -> AVAudioPCMBuffer? {
    guard let description = CMSampleBufferGetFormatDescription(sampleBuffer) else { return nil }
    let format = AVAudioFormat(cmAudioFormatDescription: description)
    let frames = AVAudioFrameCount(CMSampleBufferGetNumSamples(sampleBuffer))
    guard frames > 0,
          let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)
    else { return nil }
    buffer.frameLength = frames
    let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
        sampleBuffer,
        at: 0,
        frameCount: Int32(frames),
        into: buffer.mutableAudioBufferList
    )
    return status == noErr ? buffer : nil
}

/// Abre o UID pedido. Device sumido ou que falhou ao abrir cai no padrão e
/// AVISA; a preferência não é apagada. O retorno contém a entrada REAL que será
/// publicada no `ready`, para não confiar apenas no seletor nem num status.
func makeCaptureInput(preferredUID: String?) throws -> (AVCaptureDeviceInput, String?) {
    guard let fallback = AVCaptureDevice.default(for: .audio) else {
        throw NSError(
            domain: "Frota.STT",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "nenhum microfone disponível"]
        )
    }
    guard let uid = preferredUID else {
        return (try AVCaptureDeviceInput(device: fallback), nil)
    }
    guard let preferred = AVCaptureDevice(uniqueID: uid), preferred.isConnected else {
        return (
            try AVCaptureDeviceInput(device: fallback),
            "o microfone escolhido não está conectado; usando o padrão do sistema"
        )
    }
    do {
        return (try AVCaptureDeviceInput(device: preferred), nil)
    } catch {
        guard preferred.uniqueID != fallback.uniqueID else { throw error }
        return (
            try AVCaptureDeviceInput(device: fallback),
            "não consegui abrir o microfone “\(preferred.localizedName)”; usando o padrão do sistema"
        )
    }
}

let captureInput: AVCaptureDeviceInput
let inputWarn: String?
do {
    (captureInput, inputWarn) = try makeCaptureInput(preferredUID: deviceUID)
} catch {
    emit(["error": "não consegui abrir o microfone: \(error.localizedDescription)"])
    removeAudioFile()
    exit(1)
}
if let inputWarn { emit(["warn": inputWarn]) }

let captureSession = AVCaptureSession()
let captureOutput = AVCaptureAudioDataOutput()
let captureQueue = DispatchQueue(label: "frota.stt.capture")
let firstBuffer = DispatchSemaphore(value: 0)
var firstBufferArrived = false // tocado só na captureQueue
var captureObservers: [NSObjectProtocol] = []
let audioFileLock = NSLock()
var audioFile: AVAudioFile?
var audioConverter: AVAudioConverter?
var audioFileFormat: AVAudioFormat?
var audioUsable = true
var peakRms: Float = 0 // tocado só na captureQueue; lido depois de sync {}
var lastLevelEmitAt: TimeInterval = 0

func signalFirstBuffer() { // chamar só na captureQueue
    if firstBufferArrived { return }
    firstBufferArrived = true
    firstBuffer.signal()
}

@Sendable func removeCaptureObservers() {
    let center = NotificationCenter.default
    captureObservers.forEach { center.removeObserver($0) }
    captureObservers.removeAll()
}

/// Desconexão/interrupção fecha a sessão pelo MESMO pipeline do STOP: preserva
/// tudo que já foi dito e avisa a UI, em vez de deixar um falso "ouvindo".
func captureWasLost(_ message: String) {
    stateLock.lock()
    if stopped || finished {
        stateLock.unlock()
        return
    }
    stopped = true
    stateLock.unlock()
    emit(["captureLost": message])
    DispatchQueue.global().async { stopPipeline() }
    DispatchQueue.global().asyncAfter(deadline: .now() + 8) {
        stateLock.lock()
        let full = streamedText()
        stateLock.unlock()
        finish(full, warn: full.isEmpty
            ? message
            : "\(message) O texto capturado até aqui foi aproveitado.")
    }
}

let microphoneSink = MicrophoneSink { sampleBuffer in
    stateLock.lock()
    let req = activeRequest
    stateLock.unlock()
    req?.appendAudioSampleBuffer(sampleBuffer)

    guard let buffer = pcmBuffer(from: sampleBuffer) else {
        audioFileLock.lock()
        audioUsable = false
        audioFile = nil
        audioFileLock.unlock()
        signalFirstBuffer()
        return
    }

    let rms = rmsAmplitude(buffer)
    peakRms = max(peakRms, rms)
    let now = ProcessInfo.processInfo.systemUptime
    if now - lastLevelEmitAt >= 0.1 {
        lastLevelEmitAt = now
        emit(["level": meterLevel(forRms: rms)])
    }

    audioFileLock.lock()
    if audioUsable {
        do {
            if audioFile == nil {
                guard let canonical = AVAudioFormat(
                    commonFormat: .pcmFormatFloat32,
                    sampleRate: buffer.format.sampleRate,
                    channels: buffer.format.channelCount,
                    interleaved: false
                ),
                let converter = AVAudioConverter(from: buffer.format, to: canonical)
                else {
                    throw NSError(
                        domain: "Frota.STT",
                        code: 2,
                        userInfo: [NSLocalizedDescriptionKey: "formato do microfone incompatível"]
                    )
                }
                audioFileFormat = canonical
                audioConverter = converter
                audioFile = try AVAudioFile(
                    forWriting: audioURL,
                    settings: canonical.settings
                )
            }
            guard let canonical = audioFileFormat,
                  let converter = audioConverter,
                  let converted = AVAudioPCMBuffer(
                      pcmFormat: canonical,
                      frameCapacity: buffer.frameLength
                  )
            else {
                throw NSError(
                    domain: "Frota.STT",
                    code: 3,
                    userInfo: [NSLocalizedDescriptionKey: "conversor do microfone indisponível"]
                )
            }
            // Bluetooth HFP entrega Int16/16 kHz; o microfone interno, Float32.
            // Normalizar o CAF evita o abort do ExtAudioFile ao receber Int16
            // interleaved, sem mudar sample rate nem canais do device escolhido.
            try converter.convert(to: converted, from: buffer)
            try audioFile?.write(from: converted)
        } catch {
            // gravação furada = arquivo NÃO confiável: derruba a passada de
            // arquivo (o STOP cai no streaming, com aviso) em vez de transcrever
            // um áudio truncado achando que é a verdade.
            audioFile = nil
            audioConverter = nil
            audioFileFormat = nil
            audioUsable = false
        }
    }
    audioFileLock.unlock()
    signalFirstBuffer()
}

captureSession.beginConfiguration()
guard captureSession.canAddInput(captureInput) else {
    emit(["error": "não consegui conectar o microfone escolhido à captura"])
    removeAudioFile()
    exit(1)
}
captureSession.addInput(captureInput)
captureOutput.setSampleBufferDelegate(microphoneSink, queue: captureQueue)
guard captureSession.canAddOutput(captureOutput) else {
    emit(["error": "não consegui preparar a captura do microfone"])
    removeAudioFile()
    exit(1)
}
captureSession.addOutput(captureOutput)
captureSession.commitConfiguration()

startUtterance() // task pronto ANTES da captura ligar: nenhum buffer se perde
captureSession.startRunning()
guard captureSession.isRunning else {
    emit(["error": "não consegui iniciar a captura do microfone"])
    removeAudioFile()
    exit(1)
}
guard firstBuffer.wait(timeout: .now() + 2) == .success else {
    captureSession.stopRunning()
    emit(["error": "o microfone abriu, mas não entregou áudio"])
    removeAudioFile()
    exit(1)
}
emit([
    "ready": true,
    "deviceUid": captureInput.device.uniqueID,
    "deviceName": captureInput.device.localizedName,
])

let center = NotificationCenter.default
captureObservers.append(center.addObserver(
    forName: AVCaptureDevice.wasDisconnectedNotification,
    object: captureInput.device,
    queue: nil
) { _ in
    captureWasLost("O microfone “\(captureInput.device.localizedName)” foi desconectado.")
})
captureObservers.append(center.addObserver(
    forName: AVCaptureSession.wasInterruptedNotification,
    object: captureSession,
    queue: nil
) { _ in
    captureWasLost("A captura do microfone “\(captureInput.device.localizedName)” foi interrompida.")
})
captureObservers.append(center.addObserver(
    forName: AVCaptureSession.runtimeErrorNotification,
    object: captureSession,
    queue: nil
) { _ in
    captureWasLost("A captura do microfone “\(captureInput.device.localizedName)” falhou.")
})

// ---- REGRA 2 (parte 2): a passada sobre o ARQUIVO INTEIRO ──────────────────

/// Desfecho da passada de arquivo: texto ou motivo honesto da falha.
enum FilePass {
    case text(String)
    case failed(String)
}

/// Transcreve o arquivo da sessão INTEIRO (on-device, mesma stack do streaming).
/// Bloqueia até o resultado ou até `deadline` segundos.
@Sendable func transcribeFile(_ url: URL, deadline: TimeInterval) -> FilePass {
    let fm = FileManager.default
    let attrs = try? fm.attributesOfItem(atPath: url.path)
    let size = (attrs?[.size] as? NSNumber)?.intValue ?? 0
    guard size > 0 else {
        return .failed("o áudio da sessão não ficou gravado")
    }
    let request = SFSpeechURLRecognitionRequest(url: url)
    request.shouldReportPartialResults = false
    request.requiresOnDeviceRecognition = true
    if #available(macOS 13.0, *) {
        request.addsPunctuation = true
    }
    if !vocab.isEmpty {
        request.contextualStrings = vocab
    }
    let lock = NSLock()
    var outcome: FilePass?
    let sem = DispatchSemaphore(value: 0)
    let task = recognizer.recognitionTask(with: request) { result, err in
        lock.lock()
        defer { lock.unlock() }
        if outcome != nil { return } // já concluído (ou já estourou o prazo)
        if let r = result, r.isFinal {
            outcome = .text(r.bestTranscription.formattedString)
            sem.signal()
            return
        }
        if let e = err as NSError? {
            outcome = .failed("\(e.localizedDescription) [\(e.domain) \(e.code)]")
            sem.signal()
        }
    }
    if sem.wait(timeout: .now() + deadline) == .timedOut {
        lock.lock()
        let already = outcome
        if already == nil { outcome = .failed("prazo esgotado na leitura do áudio") }
        lock.unlock()
        if already == nil { task.cancel() }
    }
    lock.lock()
    defer { lock.unlock() }
    return outcome ?? .failed("a passada de arquivo não respondeu")
}

/// Pipeline do STOP: drena o mic, encerra o áudio, roda a passada de arquivo e
/// conclui. Roda fora da thread do stdin (bloqueia de propósito).
@Sendable func stopPipeline() {
    removeCaptureObservers()
    stateLock.lock()
    let request = activeRequest
    stateLock.unlock()
    // 1) DRAIN com o mic AINDA aberto: os últimos buffers da captura chegam ao
    //    request (depois do endAudio, append é ignorado — por isso o drain vem
    //    ANTES dele). É o fim da frase que sumia.
    Thread.sleep(forTimeInterval: 0.3)
    // 2) fecha a entrada de áudio do reconhecedor e SÓ ENTÃO para a captura.
    request?.endAudio()
    captureSession.stopRunning()
    captureOutput.setSampleBufferDelegate(nil, queue: nil)
    captureQueue.sync {} // nenhum write do callback segue em voo
    let noSignalWarning = peakRms < 0.0005
        ? "Não detectei sinal no microfone “\(captureInput.device.localizedName)”. Confira a entrada de som do macOS."
        : nil
    audioFileLock.lock()
    audioFile = nil // fecha o arquivo (flush) — o ExtAudioFile solta no deinit
    audioConverter = nil
    audioFileFormat = nil
    let fileOK = audioUsable
    audioFileLock.unlock()
    // 3) dá um tempo curto pro streaming fechar (melhora o texto de fallback).
    _ = streamingDone.wait(timeout: .now() + 1.2)
    stateLock.lock()
    let streamingTask = activeTask
    activeRequest = nil // callbacks atrasados viram stale (não mexem mais no estado)
    let fallback = streamedText()
    stateLock.unlock()
    streamingTask?.cancel() // fora do lock: o cancel pode chamar o handler

    func warningForOutcome(_ warning: String?) -> String? {
        warning ?? (fallback.isEmpty ? noSignalWarning : nil)
    }

    // 4) a verdade: passada sobre o arquivo inteiro.
    guard fileOK else {
        let warning = fallback.isEmpty
            ? nil
            : "o áudio da sessão não pôde ser gravado, texto veio do reconhecimento ao vivo"
        finish(fallback, warn: warningForOutcome(warning))
        return
    }
    switch transcribeFile(audioURL, deadline: 5.0) {
    case .text(let t):
        let best = moreComplete(t, fallback)
        // a passada de arquivo é a verdade, MAS nunca entrega menos fala que o
        // streaming (regra 1 vale também aqui): se ela veio mais curta e
        // divergente, o streaming ganha — com aviso.
        let warn = normalizedForCompare(best) == normalizedForCompare(t)
            ? nil
            : "a leitura do áudio veio incompleta, texto do reconhecimento ao vivo aproveitado"
        finish(best, warn: warningForOutcome(warn))
    case .failed(let why):
        let warning = fallback.isEmpty
            ? nil
            : "não deu pra reler o áudio (\(why)), texto do reconhecimento ao vivo aproveitado"
        finish(fallback, warn: warningForOutcome(warning))
    }
}

// ---- controle via stdin (a mesma linha de vida dos agents).
DispatchQueue.global().async {
    while let line = readLine(strippingNewline: true) {
        if line == "STOP" {
            stateLock.lock()
            if stopped {
                stateLock.unlock()
                return
            }
            stopped = true
            stateLock.unlock()
            DispatchQueue.global().async { stopPipeline() }
            // rede: se a passada de arquivo travar, devolve o acumulado do
            // streaming (a UI nunca fica pendurada).
            DispatchQueue.global().asyncAfter(deadline: .now() + 8) {
                stateLock.lock()
                let full = streamedText()
                stateLock.unlock()
                finish(full, warn: full.isEmpty
                    ? nil
                    : "a transcrição demorou demais, texto do reconhecimento ao vivo aproveitado")
            }
            return
        }
        if line == "CANCEL" {
            removeAudioFile()
            exit(0)
        }
    }
    removeAudioFile()
    exit(0) // stdin fechou: o app morreu, não fica órfão
}

RunLoop.main.run()
