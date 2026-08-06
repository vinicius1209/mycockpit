// mycockpit-stt: sidecar de ditado ON-DEVICE (pt-BR) do MyCockpit.
// O cockpit fala com ele igual fala com os agents: spawn + JSON por linha.
//
//   stdin:  "STOP"   → encerra o áudio e devolve o texto final
//           "CANCEL" → descarta e sai
//           EOF      → app morreu, sai (não vira órfão)
//   stdout: {"ready":true} → gravando
//           {"partial":"…"} → transcrição parcial (ao vivo, texto COMPLETO)
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
// ── NÃO COMER O FIM DA FRASE (D1 do docs/dictation-plan.md) ────────────────
//
// 1) ORDEM DO STOP. O código antigo parava o engine e removia o tap ANTES do
//    endAudio: o áudio em voo morria no caminho e as últimas sílabas nunca
//    chegavam ao reconhecedor. Agora o STOP faz drain curto com o mic AINDA
//    aberto (os últimos buffers do tap entram no request) → endAudio() →
//    engine.stop()/removeTap. O drain vem ANTES do endAudio porque depois dele
//    todo append é ignorado.
//
// 2) O FINAL NUNCA ENCURTA (`moreComplete`, pura e coberta por --selftest).
//    O resultado final do reconhecedor PODE vir mais curto que o parcial que o
//    usuário acabou de ver (ele reavalia e às vezes descarta o rabo da frase).
//    Guardamos `bestCurrent` = o texto MAIS COMPLETO já visto na utterance
//    corrente e, em todo desfecho, entregamos o mais completo entre o candidato
//    e o melhor visto: quem ESTENDE/contém vence; quem é PEDAÇO do outro perde;
//    se divergiram, vence quem tem mais palavras; empate normalizado (só mudou
//    pontuação/acento/caixa) fica com o candidato, que é o mais bem formatado.
//    Nenhuma heurística de "metade do tamanho" decide o final.

import AVFoundation
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

// ---- A REGRA "o final nunca encurta", pura ─────────────────────────────────

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

/// A REGRA: devolve o MAIS COMPLETO entre `candidate` (texto novo/final) e
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

// ---- args: --vocab "termo1,termo2" · --selfcheck (diagnóstico sem gravar)
//            --selftest (a regra em teste puro, sem mic nem permissão)
var vocab: [String] = []
var selfcheck = false
var selftest = false
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
    }
}

/// Teste puro da regra, embutido no próprio binário: o projeto não tem harness
/// Swift (o sidecar é um único arquivo compilado pelo build.rs), então a suíte
/// vive aqui e é executada pelo `cargo test` (stt.rs) rodando
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
    emit(["selftest": "moreComplete", "cases": cases.count, "failures": failures])
    return failures == 0 ? 0 : 1
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
var bestCurrent = ""  // o texto mais COMPLETO já visto nesta utterance
var stopped = false   // STOP recebido: o próximo desfecho encerra o processo
var finished = false  // resposta final já emitida (once)
var activeRequest: SFSpeechAudioBufferRecognitionRequest?
var activeTask: SFSpeechRecognitionTask?

func joined(_ a: String, _ b: String) -> String {
    if a.isEmpty { return b }
    if b.isEmpty { return a }
    return a + " " + b
}

/// O melhor texto que o reconhecimento conseguiu até agora (a regra aplicada à
/// utterance corrente). É o que qualquer desfecho entrega.
func streamedText() -> String { // chamar com o stateLock TRAVADO
    joined(committed, moreComplete(current, bestCurrent))
}

func finish(_ text: String) {
    stateLock.lock()
    if finished {
        stateLock.unlock()
        return
    }
    finished = true
    stateLock.unlock()
    emit(["text": text])
    exit(0)
}

func makeRequest() -> SFSpeechAudioBufferRecognitionRequest {
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    if recognizer.supportsOnDeviceRecognition {
        request.requiresOnDeviceRecognition = true
    }
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
            // contra final curto (essa é o moreComplete): é a detecção de que o
            // reconhecedor jogou a utterance fora.
            if !bestCurrent.isEmpty && bestCurrent.count > 20
                && t.count * 2 < bestCurrent.count && !bestCurrent.hasPrefix(t) {
                committed = joined(committed, bestCurrent)
                bestCurrent = ""
            }
            current = t
            bestCurrent = moreComplete(t, bestCurrent)
            if r.isFinal {
                // utterance fechou (pausa na fala / limite do serviço): commita o
                // MAIS COMPLETO entre o final e o melhor parcial e, se ainda
                // gravando, REINICIA — o ditado continua.
                committed = joined(committed, moreComplete(t, bestCurrent))
                current = ""
                bestCurrent = ""
                let full = committed
                let wasStopped = stopped
                stateLock.unlock()
                if wasStopped {
                    finish(full)
                } else {
                    startUtterance()
                }
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
            let full = committed
            let wasStopped = stopped
            stateLock.unlock()
            // depois do STOP, qualquer desfecho entrega o que temos (graceful)
            if wasStopped {
                finish(full)
                return
            }
            // silêncio / fim de utterance NO MEIO da gravação → reinicia (o
            // usuário segue com o mic aberto; matar a sessão aqui perdia fala).
            if e.domain == "kAFAssistantErrorDomain" && (e.code == 1110 || e.code == 203) {
                startUtterance()
                return
            }
            // Ditado do sistema desligado: aponta o caminho exato do Ajuste.
            if e.domain == "kLSRErrorDomain" && e.code == 201 {
                emit(["error": "ative o Ditado do macOS: Ajustes do Sistema → Teclado → Ditado (ligar). Baixe o pacote Português (Brasil)."])
                exit(1)
            }
            // falha real: se já há texto acumulado, entrega em vez de perder.
            if !full.isEmpty {
                finish(full)
                return
            }
            emit(["error": "o reconhecimento falhou: \(e.localizedDescription) [\(e.domain) \(e.code)]"])
            exit(1)
        } else {
            stateLock.unlock()
        }
    }
}

// ---- microfone → buffers → reconhecedor CORRENTE (o request troca no restart).
let engine = AVAudioEngine()
let input = engine.inputNode
let format = input.outputFormat(forBus: 0)
input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
    stateLock.lock()
    let req = activeRequest
    stateLock.unlock()
    req?.append(buffer)
}
engine.prepare()
startUtterance() // task pronto ANTES do engine ligar: nenhum buffer se perde
do {
    try engine.start()
} catch {
    emit(["error": "não consegui abrir o microfone: \(error.localizedDescription)"])
    exit(1)
}
emit(["ready": true])

/// Pipeline do STOP (ver regra 1 no topo). Roda fora da thread do stdin porque
/// bloqueia de propósito: o drain é o que salva o fim da frase.
func stopPipeline(request: SFSpeechAudioBufferRecognitionRequest?) {
    Thread.sleep(forTimeInterval: 0.3) // drain com o mic ainda aberto
    request?.endAudio()                // só então o reconhecedor fecha a entrada
    engine.stop()
    input.removeTap(onBus: 0)
}

// ---- controle via stdin (a mesma linha de vida dos agents).
DispatchQueue.global().async {
    while let line = readLine(strippingNewline: true) {
        if line == "STOP" {
            stateLock.lock()
            stopped = true
            let req = activeRequest
            stateLock.unlock()
            DispatchQueue.global().async { stopPipeline(request: req) }
            // se o isFinal demorar, devolve o acumulado (nunca trava a UI)
            DispatchQueue.global().asyncAfter(deadline: .now() + 8) {
                stateLock.lock()
                let full = streamedText()
                stateLock.unlock()
                finish(full)
            }
            return
        }
        if line == "CANCEL" {
            exit(0)
        }
    }
    exit(0) // stdin fechou: o app morreu, não fica órfão
}

RunLoop.main.run()
