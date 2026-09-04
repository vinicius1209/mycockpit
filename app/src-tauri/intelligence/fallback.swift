// Sidecar mínimo para builders sem Foundation Models. Ele mantém o protocolo
// íntegro: indisponibilidade é dado, não falha de boot nem de build.
private let arguments = CommandLine.arguments

private func jsonField(_ name: String, in input: String) -> String? {
    let marker = "\"\(name)\":\""
    guard let start = input.range(of: marker)?.upperBound,
          let end = input[start...].firstIndex(of: "\"") else { return nil }
    return String(input[start..<end])
}

@main
private struct FrotaIntelligenceUnavailable {
    static func main() {
        if arguments.contains("--probe") || arguments.contains("--self-test") {
            print("{\"contextSize\":null,\"frameworkAvailable\":false,\"locale\":\"pt-BR\",\"protocolVersion\":1,\"reason\":\"framework_unavailable\",\"status\":\"unavailable\",\"supportsLocale\":false}")
            return
        }
        let input = readLine(strippingNewline: false) ?? ""
        let attempt = jsonField("attemptId", in: input) ?? "unknown"
        let task = jsonField("task", in: input) ?? "unknown"
        print("{\"attemptId\":\"\(attempt)\",\"error\":{\"code\":\"framework_unavailable\",\"retryable\":false},\"protocolVersion\":1,\"status\":\"error\",\"task\":\"\(task)\"}")
    }
}
