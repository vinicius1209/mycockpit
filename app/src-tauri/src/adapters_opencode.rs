//! O fechamento do turno do OpenCode: o uso somado step a step (e o dos
//! subagentes), e a recusa que o motor atribui ao humano.
//!
//! Cada `step_finish` é uma chamada ao provider com custo e tokens PRÓPRIOS,
//! não um acumulado. Medido em 26/09/2026 (opencode 1.18.32, kimi-k3): o banco
//! do opencode grava um `message` por step com o `cost` dele, o gateway cobra
//! um request por step, e `session.cost` é a soma. Ficar com o último step
//! mostrou US$ 0,084 num turno de sete steps que custou US$ 0,448.

use crate::agent::AgentEvent;
use serde_json::Value;

#[derive(Default)]
pub struct UsoOpenCode {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub cost: Option<f64>,
}

impl UsoOpenCode {
    /// Soma o `part` de um `step_finish`.
    pub fn somar_step(&mut self, p: &Value) {
        let tk = p.get("tokens");
        let n = |k: &str| {
            tk.and_then(|t| t.get(k))
                .and_then(Value::as_u64)
                .unwrap_or(0)
        };
        let cache = tk.and_then(|t| t.get("cache"));
        let c = |k: &str| {
            cache
                .and_then(|x| x.get(k))
                .and_then(Value::as_u64)
                .unwrap_or(0)
        };
        // input + cache.read: o `input` do opencode EXCLUI o cache (medido), e
        // o nosso contrato INCLUI.
        self.input += n("input") + c("read");
        // `output` também EXCLUI o reasoning (total = input + cache.read +
        // output + reasoning), e o gateway cobra os dois como saída (step com
        // output 844 + reasoning 588 saiu como 1432 no log). O contrato do app
        // é o do codex e do agy: saída INCLUI o raciocínio.
        self.output += n("output") + n("reasoning");
        self.cache_read += c("read");
        self.cache_write += c("write");
        // Um step sem `cost` não zera o que os outros reportaram, e turno sem
        // nenhum `cost` segue `None` (Unknown), nunca US$ 0,00.
        if let Some(x) = p.get("cost").and_then(Value::as_f64) {
            self.cost = Some(self.cost.unwrap_or(0.0) + x);
        }
    }
}

/// Id da sessão filha num `tool_use` do `task` (subagente). O stream do
/// `opencode run` NÃO traz nenhum step do filho (medido em 26/09/2026 com um
/// `@explore` real); o único rastro é `state.metadata.sessionId`. Sem ele, um
/// subagente de US$ 1,68 sumiu da conta de um turno.
pub fn filho_do_task(part: &Value) -> Option<String> {
    if part.get("tool").and_then(Value::as_str) != Some("task") {
        return None;
    }
    part.pointer("/state/metadata/sessionId")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// A saída do `opencode export <id>` é JSON puro no stdout (a linha
/// "Exporting session" vai pro stderr), mas lemos a partir do primeiro `{`
/// para não depender disso.
pub fn ler_export(saida: &str) -> Option<Value> {
    serde_json::from_str(&saida[saida.find('{')?..]).ok()
}

impl UsoOpenCode {
    /// Soma o total de uma sessão exportada (`info.cost`, `info.tokens`, que
    /// o opencode mantém como soma dos steps dela) e devolve os netos: os
    /// `task` que o próprio filho disparou.
    pub fn somar_sessao(&mut self, export: &Value) -> Vec<String> {
        let info = export.get("info");
        let tk = info.and_then(|i| i.get("tokens"));
        let n = |p: &str| {
            tk.and_then(|t| t.pointer(p))
                .and_then(Value::as_u64)
                .unwrap_or(0)
        };
        self.input += n("/input") + n("/cache/read");
        self.output += n("/output") + n("/reasoning");
        self.cache_read += n("/cache/read");
        self.cache_write += n("/cache/write");
        if let Some(x) = info.and_then(|i| i.get("cost")).and_then(Value::as_f64) {
            self.cost = Some(self.cost.unwrap_or(0.0) + x);
        }
        export
            .get("messages")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|m| m.get("parts").and_then(Value::as_array))
            .flatten()
            .filter_map(filho_do_task)
            .collect()
    }
}

/// O `opencode export <id>` real. Só roda quando o turno disparou subagente.
pub fn exportar_sessao(id: &str) -> Result<String, String> {
    crate::proc::run("opencode", &["export", id], None)
}

/// Soma ao uso do turno o total de cada subagente, e dos netos que ele
/// disparou. Filho que não se deixa ler NÃO vira zero calado: sai um aviso
/// dizendo que o custo do turno está incompleto.
pub fn somar_filhos(
    uso: Option<UsoOpenCode>,
    mut fila: Vec<String>,
    exportar: fn(&str) -> Result<String, String>,
) -> (Option<UsoOpenCode>, Vec<AgentEvent>) {
    let (mut uso, mut avisos, mut vistos) = (uso, Vec::new(), Vec::<String>::new());
    while let Some(id) = fila.pop() {
        if vistos.contains(&id) {
            continue;
        }
        match exportar(&id).ok().as_deref().and_then(ler_export) {
            Some(v) => fila.extend(uso.get_or_insert_with(UsoOpenCode::default).somar_sessao(&v)),
            None => avisos.push(AgentEvent::Notice {
                message: format!(
                    "Não consegui ler o custo do subagente {id} do OpenCode, então o custo deste turno está incompleto."
                ),
            }),
        }
        vistos.push(id);
    }
    (uso, avisos)
}

/// O `opencode run` sem bypass **não pergunta: auto-rejeita**, e grava no turno
/// `"The user rejected permission to use this specific tool call."` (medido em
/// 26/08/2026). A frase é do fornecedor e atribui ao HUMANO uma recusa que a
/// máquina tomou sozinha. Esta função separa as duas: só é "recusa sem
/// pergunta" quando o bypass NÃO foi passado. Com bypass ligado, uma recusa que
/// chegue veio de regra do próprio opencode, e a frase dele fica de pé.
pub fn rejeicao_sem_pergunta(bypass: bool, status: &str, erro: &str) -> bool {
    !bypass && status == "error" && erro.contains("rejected permission")
}

/// O que o app diz no lugar da frase do fornecedor. Precisa responder o que a
/// pessoa vai perguntar ("recusei?") e o que fazer agora.
pub fn mensagem_de_rejeicao_sem_pergunta(tool: &str) -> String {
    format!(
        "o opencode recusou `{tool}` sozinho, sem perguntar a ninguém. Este motor \
         só tem o bypass tudo-ou-nada: fora do modo Liberado ele auto-rejeita toda \
         ferramenta, e registra a recusa como se fosse sua. Rode em Liberado ou \
         escolha outro motor enquanto o canal de permissão não existe."
    )
}

/// O acumulado da SESSÃO depois deste turno, no mesmo recorte do
/// `usage_update` do ACP (só a sessão, sem os filhos: `session.cost` do
/// opencode não soma subagente). Devolvido ao front como base do próximo
/// turno, é o que mantém a conta certa quando a conversa alterna entre o
/// `run` e o ACP. Retomada sem base: não há como saber, e nada se inventa.
pub fn total_da_sessao(retomada: bool, base: Option<f64>, proprio: Option<f64>) -> Option<f64> {
    let proprio = proprio?;
    match (retomada, base) {
        (false, _) => Some(proprio),
        (true, Some(b)) => Some(b + proprio),
        (true, None) => None,
    }
}

/// Um `tool_use` do `opencode run`: a ferramenta no contrato (o fio mostra
/// "Ler", "Executar"…), o filho do `task` guardado para a conta, e a recusa
/// que ninguém perguntou virando erro (devolvido para o adapter marcar o
/// turno como falho).
pub fn tool_use(
    part: &Value,
    bypass: bool,
    filhos: &mut Vec<String>,
) -> (Vec<AgentEvent>, Option<String>) {
    if let Some(id) = filho_do_task(part) {
        if !filhos.contains(&id) {
            filhos.push(id);
        }
    }
    let st = part.get("state");
    let campo = |k: &str| {
        st.and_then(|s| s.get(k))
            .and_then(Value::as_str)
            .unwrap_or("")
    };
    if rejeicao_sem_pergunta(bypass, campo("status"), campo("error")) {
        let tool = part
            .get("tool")
            .and_then(Value::as_str)
            .unwrap_or("a ferramenta");
        let msg = mensagem_de_rejeicao_sem_pergunta(tool);
        return (
            vec![AgentEvent::Error {
                message: msg.clone(),
            }],
            Some(msg),
        );
    }
    (super::opencode_ferramentas::do_tool_use(part), None)
}
