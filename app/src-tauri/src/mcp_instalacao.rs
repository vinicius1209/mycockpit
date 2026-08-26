//! Como o app INSTALA um MCP externo em cada motor (F2 do
//! `docs/mcp-qualquer-agent-plan.md`).
//!
//! A restrição que manda no desenho: o Frota vai ser instalado em outras
//! máquinas, então **nada pode ser fixo aqui**. A consequência prática, e a
//! razão deste módulo existir:
//!
//! > o app NÃO guarda o caminho do config de agent nenhum. Onde o arquivo mora
//! > é conhecimento do fornecedor, muda com a versão e com o sistema. Guardar
//! > esse caminho é criar exatamente o "fixo aqui" que foi proibido.
//!
//! Em vez disso, para config de USUÁRIO o app roda o comando do próprio CLI
//! (`agy mcp add …`) e deixa ele decidir onde escrever naquela máquina.
//!
//! **A exceção medida, e por que ela não fere a regra:** config de PROJETO é um
//! nome de arquivo relativo ao diretório que o usuário escolheu
//! (`opencode.json`), não um caminho de máquina. Escrever isso é portátil por
//! definição. E é necessário: medido em 26/08/2026 que o `opencode mcp add`
//! grava no config GLOBAL mesmo rodando de dentro do projeto, ou seja, o CLI
//! dele não escreve no escopo que ele mesmo LÊ. Usar o CLI ali daria escopo
//! global calado, o oposto do que a tela promete.
//!
//! Nome de agent aparece aqui de propósito: é a mesma natureza do `update.rs`
//! e do `model_list.rs`, os módulos por-provider legítimos. O código GENÉRICO
//! nunca vê estes nomes, só o resultado.

use crate::adapters::{capabilities_of, McpEscopo};

/// O transporte do servidor que se quer instalar.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum McpAlvo {
    /// Processo local. `comando` é o executável, `args` o resto.
    Stdio { comando: String, args: Vec<String> },
    /// Endpoint HTTP.
    Http { url: String },
}

/// O que instalar. Campos vazios simplesmente não viram flag.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpSpec {
    pub nome: String,
    pub alvo: McpAlvo,
    /// Cabeçalhos HTTP, como (chave, valor). Só fazem sentido em `Http`.
    pub headers: Vec<(String, String)>,
    /// Variáveis de ambiente, como (chave, valor). Só fazem sentido em `Stdio`.
    pub env: Vec<(String, String)>,
}

/// Por onde a instalação passa neste motor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum McpInstalacao {
    /// Não há o que instalar: a config viaja no spawn e morre com ele.
    NoSpawn,
    /// Roda o comando do CLI do agent. O app não sabe (nem quer saber) onde o
    /// arquivo fica.
    PeloCli,
    /// Escreve um arquivo do PROJETO, pelo NOME (relativo ao diretório). Sem
    /// caminho de máquina, portanto sem nada fixo.
    ArquivoDoProjeto(&'static str),
}

/// Por onde instalar em `agent`. Sai do ESCOPO declarado (capability), não de
/// um `match` por nome: motor novo com escopo conhecido já entra certo.
///
/// A exceção é o `PorProjeto`, que precisa saber QUAL arquivo, e isso é
/// dialeto do fornecedor como qualquer outro deste módulo.
pub fn instalacao_de(agent: &str) -> Option<McpInstalacao> {
    let escopo = capabilities_of(agent)?.mcp_escopo;
    Some(match escopo {
        McpEscopo::PorRun => McpInstalacao::NoSpawn,
        McpEscopo::Global => McpInstalacao::PeloCli,
        McpEscopo::PorProjeto => match agent {
            "opencode" => McpInstalacao::ArquivoDoProjeto("opencode.json"),
            // Escopo de projeto sem arquivo conhecido não vira chute: sem
            // receita, o caller diz isso em vez de escrever no lugar errado.
            _ => return None,
        },
        McpEscopo::Nenhum => return None,
    })
}

/// argv de INSTALAR pelo CLI do agent. `None` = este motor não instala assim
/// (ou não é do registry). O primeiro item é o binário.
///
/// Sintaxe MEDIDA no `agy 1.1.21` em 26/08/2026, rodando cada forma:
/// `agy mcp add [flags] <nome> <comandoOuUrl> [args…]`, com as flags
/// obrigatoriamente ANTES do nome (o `--help` avisa que flag depois é
/// rejeitada, e foi confirmado).
pub fn install_argv(agent: &str, spec: &McpSpec) -> Option<Vec<String>> {
    if instalacao_de(agent)? != McpInstalacao::PeloCli {
        return None;
    }
    match agent {
        "agy" => Some(argv_agy_add(spec)),
        _ => None,
    }
}

/// argv de DESINSTALAR pelo CLI. Medido: `agy mcp remove <nome>` responde
/// "Removed MCP server".
pub fn uninstall_argv(agent: &str, nome: &str) -> Option<Vec<String>> {
    if instalacao_de(agent)? != McpInstalacao::PeloCli {
        return None;
    }
    match agent {
        "agy" => Some(vec![
            "agy".into(),
            "mcp".into(),
            "remove".into(),
            nome.into(),
        ]),
        _ => None,
    }
}

fn argv_agy_add(spec: &McpSpec) -> Vec<String> {
    let mut v: Vec<String> = vec!["agy".into(), "mcp".into(), "add".into()];
    // Flags primeiro, sempre. Medido: `agy mcp add --header "K: V" nome url`
    // funciona; a mesma flag depois do nome é rejeitada pelo CLI.
    for (k, val) in &spec.headers {
        // Dialeto do agy é "Chave: Valor" (dois pontos e espaço), NÃO "K=V" —
        // o opencode usa a outra forma, e trocar as duas é o tipo de erro que
        // só aparece quando o servidor recusa a chamada.
        v.push("--header".into());
        v.push(format!("{k}: {val}"));
    }
    for (k, val) in &spec.env {
        v.push("--env".into());
        v.push(format!("{k}={val}"));
    }
    v.push(spec.nome.clone());
    match &spec.alvo {
        McpAlvo::Http { url } => {
            // Sem `--type`: medido que http/https é detectado pela URL, e o
            // `--help` diz o mesmo. Não mandamos flag que não medimos.
            v.push(url.clone());
        }
        McpAlvo::Stdio { comando, args } => {
            // `--` SEMPRE antes do comando, mesmo quando ele não começa com
            // "-". Medido que funciona nos dois casos, e uniformizar remove a
            // classe inteira de bug em que um comando com hífen vira flag.
            v.push("--".into());
            v.push(comando.clone());
            v.extend(args.iter().cloned());
        }
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stdio(nome: &str, comando: &str, args: &[&str]) -> McpSpec {
        McpSpec {
            nome: nome.into(),
            alvo: McpAlvo::Stdio {
                comando: comando.into(),
                args: args.iter().map(|s| (*s).into()).collect(),
            },
            headers: vec![],
            env: vec![],
        }
    }

    #[test]
    fn por_run_nao_instala_nada_porque_a_config_vai_no_spawn() {
        for agent in ["claude-code", "codex"] {
            assert_eq!(instalacao_de(agent), Some(McpInstalacao::NoSpawn));
            // E não existe comando: pedir argv aqui é erro de quem chama.
            assert!(install_argv(agent, &stdio("x", "npx", &[])).is_none());
            assert!(uninstall_argv(agent, "x").is_none());
        }
    }

    #[test]
    fn escopo_global_instala_pelo_cli_do_proprio_agent() {
        assert_eq!(instalacao_de("agy"), Some(McpInstalacao::PeloCli));
        // Exatamente a linha que foi RODADA e respondeu
        // `Added MCP server "fs-teste" (stdio)`, com o `--` uniformizado.
        assert_eq!(
            install_argv(
                "agy",
                &stdio(
                    "fs-teste",
                    "npx",
                    &["-y", "@modelcontextprotocol/server-filesystem", "/work"]
                )
            )
            .unwrap(),
            vec![
                "agy",
                "mcp",
                "add",
                "fs-teste",
                "--",
                "npx",
                "-y",
                "@modelcontextprotocol/server-filesystem",
                "/work"
            ]
        );
    }

    #[test]
    fn http_leva_header_no_dialeto_do_agy_e_sem_type() {
        let spec = McpSpec {
            nome: "api-teste".into(),
            alvo: McpAlvo::Http { url: "https://example.com/mcp".into() },
            headers: vec![("Authorization".into(), "Bearer XYZ".into())],
            env: vec![],
        };
        // Medido: esta linha respondeu `Added MCP server "api-teste" (http)`.
        assert_eq!(
            install_argv("agy", &spec).unwrap(),
            vec![
                "agy",
                "mcp",
                "add",
                "--header",
                "Authorization: Bearer XYZ",
                "api-teste",
                "https://example.com/mcp"
            ]
        );
    }

    #[test]
    fn a_flag_vem_antes_do_nome_porque_o_cli_rejeita_depois() {
        let spec = McpSpec {
            nome: "com-env".into(),
            alvo: McpAlvo::Stdio {
                comando: "docker".into(),
                args: vec!["run".into(), "-i".into(), "img".into()],
            },
            headers: vec![],
            env: vec![("TOKEN".into(), "abc".into())],
        };
        let argv = install_argv("agy", &spec).unwrap();
        let i_flag = argv.iter().position(|a| a == "--env").unwrap();
        let i_nome = argv.iter().position(|a| a == "com-env").unwrap();
        assert!(i_flag < i_nome, "flag depois do nome é rejeitada: {argv:?}");
        assert_eq!(argv[i_flag + 1], "TOKEN=abc");
    }

    #[test]
    fn o_traco_duplo_protege_comando_que_comeca_com_hifen() {
        // Sem o `--`, um comando assim viraria flag do próprio `agy`.
        let argv = install_argv("agy", &stdio("esquisito", "-x", &["--force"])).unwrap();
        let i = argv.iter().position(|a| a == "--").unwrap();
        assert_eq!(argv[i + 1], "-x");
        assert_eq!(argv[i + 2], "--force");
    }

    #[test]
    fn desinstalar_usa_o_comando_do_cli_e_nao_edita_arquivo() {
        assert_eq!(
            uninstall_argv("agy", "fs-teste").unwrap(),
            vec!["agy", "mcp", "remove", "fs-teste"]
        );
    }

    #[test]
    fn opencode_escreve_arquivo_do_projeto_e_nao_usa_o_cli_dele() {
        // Medido em 26/08/2026: `opencode mcp add` rodando DE DENTRO do projeto
        // gravou no config GLOBAL. O CLI dele não escreve no escopo que ele
        // mesmo lê, então usá-lo daria escopo global calado.
        assert_eq!(
            instalacao_de("opencode"),
            Some(McpInstalacao::ArquivoDoProjeto("opencode.json"))
        );
        assert!(install_argv("opencode", &stdio("x", "npx", &[])).is_none());
        // E é NOME de arquivo, não caminho: nada de máquina fica guardado.
        let McpInstalacao::ArquivoDoProjeto(arq) = instalacao_de("opencode").unwrap() else {
            panic!("esperava arquivo de projeto")
        };
        assert!(!arq.contains('/'), "guardamos nome, nunca caminho: {arq}");
    }

    #[test]
    fn agent_fora_do_registry_nao_inventa_receita() {
        assert!(instalacao_de("aider").is_none());
        assert!(install_argv("aider", &stdio("x", "npx", &[])).is_none());
        assert!(uninstall_argv("aider", "x").is_none());
    }
}
