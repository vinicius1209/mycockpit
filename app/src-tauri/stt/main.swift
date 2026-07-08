// mycockpit-stt: sidecar de ditado ON-DEVICE (pt-BR) do MyCockpit.
// O cockpit fala com ele igual fala com os agents: spawn + JSON por linha.
//
//   stdin:  "STOP"   → encerra o áudio e devolve o texto final
//           "CANCEL" → descarta e sai
//           EOF      → app morreu, sai (não vira órfão)
//   stdout: {"ready":true} → gravando
//           {"partial":"…"} → transcrição parcial (ao vivo)
//           {"text":"…"}    → texto final
//           {"error":"…"}   → falha (permissão, mic, locale)
//
// A vantagem sobre ditado genérico: --vocab injeta os TERMOS DO PROJETO
// (contextualStrings) no reconhecedor. Pontuação automática (macOS 13+).
// Permissões: o Info.plist embutido via sectcreate (ver build.rs) faz o TCC
// aceitar um binário de linha de comando.

import AVFoundation
import Foundation
import Speech

func emit(_ obj: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: obj),
          let s = String(data: d, encoding: .utf8) else { return }
    print(s)
    fflush(stdout)
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

// ---- pedido de reconhecimento: on-device quando suportado, pontuação, vocab.
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

// ---- microfone → buffers → reconhecedor.
let engine = AVAudioEngine()
let input = engine.inputNode
let format = input.outputFormat(forBus: 0)
input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
    request.append(buffer)
}
engine.prepare()
do {
    try engine.start()
} catch {
    emit(["error": "não consegui abrir o microfone: \(error.localizedDescription)"])
    exit(1)
}

var lastText = ""
var finished = false
let task = recognizer.recognitionTask(with: request) { result, err in
    if let r = result {
        lastText = r.bestTranscription.formattedString
        if r.isFinal {
            finished = true
            emit(["text": lastText])
            exit(0)
        } else {
            emit(["partial": lastText])
        }
    }
    if let e = err as NSError?, !finished {
        finished = true
        // erro DEPOIS do STOP com texto em mãos → devolve o que temos (graceful)
        if !lastText.isEmpty {
            emit(["text": lastText])
            exit(0)
        }
        // "No speech detected" (silêncio) não é falha: devolve vazio e sai limpo,
        // a UI simplesmente não adiciona nada ao rascunho.
        if e.domain == "kAFAssistantErrorDomain" && (e.code == 1110 || e.code == 203) {
            emit(["text": ""])
            exit(0)
        }
        // Ditado do sistema desligado: o SFSpeechRecognizer (mesmo on-device)
        // exige o Ditado do macOS ligado. Aponta o caminho exato do Ajuste.
        if e.domain == "kLSRErrorDomain" && e.code == 201 {
            emit(["error": "ative o Ditado do macOS: Ajustes do Sistema → Teclado → Ditado (ligar). Baixe o pacote Português (Brasil)."])
            exit(1)
        }
        // falha de verdade → carrega a causa real (domínio/código) pra dar pra ver.
        emit(["error": "o reconhecimento falhou: \(e.localizedDescription) [\(e.domain) \(e.code)]"])
        exit(1)
    }
}
_ = task
emit(["ready": true])

// ---- controle via stdin (a mesma linha de vida dos agents).
DispatchQueue.global().async {
    while let line = readLine(strippingNewline: true) {
        if line == "STOP" {
            engine.stop()
            input.removeTap(onBus: 0)
            request.endAudio()
            // se o isFinal demorar, devolve o último parcial (nunca trava a UI)
            DispatchQueue.global().asyncAfter(deadline: .now() + 8) {
                if !finished {
                    finished = true
                    emit(["text": lastText])
                    exit(0)
                }
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
