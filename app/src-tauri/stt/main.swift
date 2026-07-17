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

// ---- args: --vocab "termo1,termo2" · --selfcheck (diagnóstico sem gravar)
var vocab: [String] = []
var selfcheck = false
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
    }
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
var committed = ""   // utterances já finalizadas (o que NÃO pode mais se perder)
var current = ""     // parcial da utterance corrente
var stopped = false  // STOP recebido: o próximo final encerra o processo
var finished = false // resposta final já emitida (once)
var activeRequest: SFSpeechAudioBufferRecognitionRequest?
var activeTask: SFSpeechRecognitionTask?

func joined(_ a: String, _ b: String) -> String {
    if a.isEmpty { return b }
    if b.isEmpty { return a }
    return a + " " + b
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
            // o reconhecedor recomeçou a utterance; preserva o que já tinha.
            // (revisões legítimas nunca cortam um texto longo pela metade)
            if !current.isEmpty && current.count > 20 && t.count * 2 < current.count
                && !current.hasPrefix(t) {
                committed = joined(committed, current)
            }
            current = t
            let full = joined(committed, current)
            if r.isFinal {
                // utterance fechou (pausa na fala / limite do serviço): commita
                // e, se ainda gravando, REINICIA — o ditado continua.
                committed = full
                current = ""
                let wasStopped = stopped
                stateLock.unlock()
                if wasStopped {
                    finish(full)
                } else {
                    startUtterance()
                }
                return
            }
            stateLock.unlock()
            emit(["partial": full])
            return
        }
        if let e = err as NSError? {
            let full = joined(committed, current)
            committed = full
            current = ""
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

// ---- controle via stdin (a mesma linha de vida dos agents).
DispatchQueue.global().async {
    while let line = readLine(strippingNewline: true) {
        if line == "STOP" {
            stateLock.lock()
            stopped = true
            let req = activeRequest
            stateLock.unlock()
            engine.stop()
            input.removeTap(onBus: 0)
            req?.endAudio()
            // se o isFinal demorar, devolve o acumulado (nunca trava a UI)
            DispatchQueue.global().asyncAfter(deadline: .now() + 8) {
                stateLock.lock()
                let full = joined(committed, current)
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
