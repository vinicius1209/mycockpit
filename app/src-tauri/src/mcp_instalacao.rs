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

/// Reativa uma entrada existente sem reescrever sua configuração.
/// Sintaxe conferida em `agy mcp enable --help`, versão 1.1.27.
pub fn enable_argv(agent: &str, nome: &str) -> Option<Vec<String>> {
    match agent {
        "agy" => Some(vec![
            "agy".into(),
            "mcp".into(),
            "enable".into(),
            nome.into(),
        ]),
        _ => None,
    }
}

/// Desativa uma entrada sem apagar a configuração (reversível por
/// `enable_argv`). Sintaxe conferida em `agy mcp disable --help`, versão 1.2.8.
pub fn disable_argv(agent: &str, nome: &str) -> Option<Vec<String>> {
    match agent {
        "agy" => Some(vec![
            "agy".into(),
            "mcp".into(),
            "disable".into(),
            nome.into(),
        ]),
        _ => None,
    }
}

/// O CLI deste motor autentica um MCP OAuth sozinho?
///
/// Medido em 26/08/2026 nos dois: `opencode mcp` tem `auth`, `logout` e
/// `debug`, e o `McpRemoteConfig` deles tem campo `oauth`. O `agy mcp` tem só
/// `add|remove|list|enable|disable`, e a entrada que ele grava é
/// `serverUrl` + `headers` + `disabled`: **não há onde a credencial morar**.
///
/// Isto decide se instalar um MCP OAuth é ajuda ou armadilha. O login do FROTA
/// não viaja (é a regra do ADR-100, vista do outro lado): o proxy do app é
/// alcançado por socket efêmero mais o caminho do binário do Frota NESTA
/// máquina, e nenhuma das duas coisas cabe num arquivo que sobrevive ao run.
pub fn cli_autentica_mcp(agent: &str) -> bool {
    matches!(agent, "opencode")
}

/// Converte um servidor DESCOBERTO no que o CLI do agent precisa receber.
///
/// `Err` quando a conversão exigiria um segredo que o app não tem. A entrada de
/// origem costuma guardar REFERÊNCIA, não valor (`env_vars` lista nomes,
/// `bearerTokenEnvVar` aponta uma variável, `envHttpHeaders` idem): repassar
/// isso ao `agy mcp add` instalaria um servidor que falha na primeira chamada,
/// e o usuário veria "instalado" com o servidor quebrado. Dizer que não dá, e
/// nomear o que falta, é melhor que instalar mentindo.
pub fn spec_de(
    agent: &str,
    nome: &str,
    launch: &crate::mcp_control::McpLaunchConfig,
) -> Result<McpSpec, String> {
    // MCP com OAuth num CLI que não sabe autenticar = servidor instalado que
    // falha na primeira chamada, com a tela dizendo "instalado". O login do
    // app não cobre esse buraco: ele vive num proxy que morre com o run.
    if launch.oauth.is_some() && !cli_autentica_mcp(agent) {
        return Err(format!(
            "este MCP usa OAuth e o CLI do {agent} não tem como guardar essa \
             credencial. O login do Frota não viaja: ele vale dentro da missão, \
             não num config que sobrevive a ela."
        ));
    }
    let mut faltando: Vec<String> = Vec::new();
    if !launch.env_vars.is_empty() {
        faltando.extend(launch.env_vars.iter().cloned());
    }
    if let Some(v) = &launch.bearer_token_env_var {
        faltando.push(v.clone());
    }
    faltando.extend(launch.env_http_headers.values().cloned());
    if !faltando.is_empty() {
        faltando.sort();
        faltando.dedup();
        return Err(format!(
            "este MCP depende de valores que o Frota não guarda ({}). \
             Instale pelo CLI do agent, onde essas variáveis existem.",
            faltando.join(", ")
        ));
    }
    let alvo = match launch.transport.as_str() {
        "stdio" => McpAlvo::Stdio {
            comando: launch
                .command
                .clone()
                .ok_or("config stdio sem comando: nada a instalar")?,
            args: launch.args.clone(),
        },
        "http" => McpAlvo::Http {
            url: launch
                .url
                .clone()
                .ok_or("config http sem url: nada a instalar")?,
        },
        outro => return Err(format!("transporte {outro} não tem receita de instalação")),
    };
    Ok(McpSpec {
        nome: nome.to_string(),
        alvo,
        headers: launch
            .http_headers
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
        env: launch
            .env
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
    })
}

/// O arquivo do projeto tem comentário (ou o app não sabe afirmar que não tem)?
///
/// `//` dentro de string NÃO conta, e isso não é detalhe: toda URL `https://`
/// tem duas barras. Um detector ingênuo acusaria comentário em todo arquivo com
/// um `url`, e o app passaria a recusar escrever em quase tudo. Por isso o
/// varredor respeita aspas e escape.
fn tem_comentario(texto: &str) -> bool {
    let b = texto.as_bytes();
    let mut i = 0;
    let mut em_string = false;
    while i < b.len() {
        match b[i] {
            b'\\' if em_string => i += 1,
            b'"' => em_string = !em_string,
            b'/' if !em_string && i + 1 < b.len() && (b[i + 1] == b'/' || b[i + 1] == b'*') => {
                return true
            }
            _ => {}
        }
        i += 1;
    }
    false
}

/// A entrada JSON que o opencode espera, na forma EXATA do `config.json` deles
/// (`McpLocalConfig` / `McpRemoteConfig`, ambos `additionalProperties: false`,
/// então campo a mais é config inválida).
fn entrada_opencode(spec: &McpSpec) -> serde_json::Value {
    use serde_json::json;
    match &spec.alvo {
        McpAlvo::Stdio { comando, args } => {
            let mut cmd = vec![comando.clone()];
            cmd.extend(args.iter().cloned());
            let mut v = json!({ "type": "local", "command": cmd, "enabled": true });
            if !spec.env.is_empty() {
                // A chave é `environment`, não `env`: o schema é fechado.
                v["environment"] = serde_json::Value::Object(
                    spec.env
                        .iter()
                        .map(|(k, val)| (k.clone(), serde_json::Value::String(val.clone())))
                        .collect(),
                );
            }
            v
        }
        McpAlvo::Http { url } => {
            let mut v = json!({ "type": "remote", "url": url, "enabled": true });
            if !spec.headers.is_empty() {
                v["headers"] = serde_json::Value::Object(
                    spec.headers
                        .iter()
                        .map(|(k, val)| (k.clone(), serde_json::Value::String(val.clone())))
                        .collect(),
                );
            }
            v
        }
    }
}

/// Escreve (ou remove) a entrada do app no JSON do PROJETO, preservando tudo
/// que não é nosso. `entrada: None` remove.
///
/// Este arquivo é do REPOSITÓRIO do usuário e pode estar versionado, então a
/// régua aqui é mais dura que a de um arquivo efêmero:
///
/// 1. **Comentário faz recusar.** O `opencode.json` aceita comentário
///    (`allowComments` no schema deles) e nenhum serializador JSON preserva
///    isso. Reescrever apagaria texto que a pessoa escreveu, num arquivo que
///    ela versiona. Melhor recusar e dizer.
/// 2. **Só a nossa chave muda.** Entradas de MCP que o usuário criou ficam
///    intactas, e qualquer outra chave do arquivo também.
/// 3. **Conferência depois de serializar.** Se alguma chave que existia antes
///    sumiu, o resultado é descartado com erro em vez de gravado.
pub fn merge_opencode_json(
    atual: &str,
    nome: &str,
    entrada: Option<&McpSpec>,
) -> Result<String, String> {
    let vazio = atual.trim().is_empty();
    if !vazio && tem_comentario(atual) {
        return Err(
            "o opencode.json deste projeto tem comentários, e gravar apagaria \
             eles. Adicione a entrada à mão na chave `mcp`."
                .into(),
        );
    }
    let mut raiz: serde_json::Value = if vazio {
        serde_json::json!({})
    } else {
        serde_json::from_str(atual).map_err(|e| format!("opencode.json inválido: {e}"))?
    };
    let antes = raiz.clone();
    let obj = raiz
        .as_object_mut()
        .ok_or("opencode.json não é um objeto JSON")?;
    let mcp = obj
        .entry("mcp")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("a chave `mcp` do opencode.json não é um objeto")?;
    match entrada {
        Some(spec) => {
            mcp.insert(nome.to_string(), entrada_opencode(spec));
        }
        None => {
            mcp.remove(nome);
        }
    }
    // Chave `mcp` que ficou vazia por remoção sai junto: não deixamos lixo
    // nosso no arquivo de quem nos hospedou.
    if obj
        .get("mcp")
        .is_some_and(|m| m.as_object().is_some_and(|o| o.is_empty()))
    {
        obj.remove("mcp");
    }
    let saida = serde_json::to_string_pretty(&raiz).map_err(|e| e.to_string())? + "\n";
    conferir_preservacao(&antes, &saida, nome)?;
    Ok(saida)
}

/// Nada que era do usuário pode ter sumido. Roda DEPOIS de serializar, sobre o
/// texto que seria gravado: é a diferença entre acreditar no merge e verificar.
fn conferir_preservacao(antes: &serde_json::Value, saida: &str, nosso: &str) -> Result<(), String> {
    let depois: serde_json::Value =
        serde_json::from_str(saida).map_err(|e| format!("o JSON gerado não relê: {e}"))?;
    let (Some(a), Some(d)) = (antes.as_object(), depois.as_object()) else {
        return Ok(());
    };
    for (k, v) in a {
        if k == "mcp" {
            let (Some(ma), Some(md)) =
                (v.as_object(), depois.get("mcp").and_then(|x| x.as_object()))
            else {
                // A chave `mcp` só pode sumir se ela era SÓ nossa e foi removida.
                if v.as_object().is_some_and(|o| o.keys().all(|k| k == nosso)) {
                    continue;
                }
                return Err("o merge perderia entradas de MCP do usuário".into());
            };
            for (nome, entrada) in ma {
                if nome == nosso {
                    continue;
                }
                if md.get(nome) != Some(entrada) {
                    return Err(format!("o merge alteraria o MCP `{nome}`, que não é nosso"));
                }
            }
            continue;
        }
        if d.get(k) != Some(v) {
            return Err(format!("o merge perderia a chave `{k}` do opencode.json"));
        }
    }
    Ok(())
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
            alvo: McpAlvo::Http {
                url: "https://example.com/mcp".into(),
            },
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

    fn launch(transport: &str) -> crate::mcp_control::McpLaunchConfig {
        crate::mcp_control::McpLaunchConfig {
            transport: transport.into(),
            ..Default::default()
        }
    }

    #[test]
    fn converte_stdio_e_http_com_o_que_e_literal() {
        let mut l = launch("stdio");
        l.command = Some("npx".into());
        l.args = vec!["-y".into(), "srv".into()];
        l.env.insert("MODO".into(), "leitura".into());
        let s = spec_de("agy", "fs", &l).unwrap();
        assert_eq!(s.nome, "fs");
        assert_eq!(s.env, vec![("MODO".to_string(), "leitura".to_string())]);
        assert!(matches!(s.alvo, McpAlvo::Stdio { .. }));

        let mut h = launch("http");
        h.url = Some("https://x/mcp".into());
        h.http_headers.insert("X-Cliente".into(), "frota".into());
        let s = spec_de("agy", "api", &h).unwrap();
        assert_eq!(
            s.headers,
            vec![("X-Cliente".to_string(), "frota".to_string())]
        );
    }

    #[test]
    fn segredo_por_referencia_recusa_em_vez_de_instalar_quebrado() {
        // A entrada de origem guarda o NOME da variável, não o valor. Instalar
        // assim daria "instalado" na tela com o servidor falhando na primeira
        // chamada, que é a pior combinação possível.
        let mut l = launch("stdio");
        l.command = Some("npx".into());
        l.env_vars = vec!["GITHUB_TOKEN".into()];
        let erro = spec_de("agy", "gh", &l).unwrap_err();
        assert!(erro.contains("GITHUB_TOKEN"), "nomeia o que falta: {erro}");
        assert!(
            erro.contains("não guarda"),
            "diz de quem é o limite: {erro}"
        );

        let mut h = launch("http");
        h.url = Some("https://x/mcp".into());
        h.bearer_token_env_var = Some("API_TOKEN".into());
        assert!(spec_de("agy", "api", &h).unwrap_err().contains("API_TOKEN"));
    }

    #[test]
    fn config_incompleta_nao_vira_comando_pela_metade() {
        // stdio sem comando e http sem url não têm o que instalar. Melhor o
        // erro aqui que um argv truncado chegando no CLI.
        assert!(spec_de("agy", "x", &launch("stdio")).is_err());
        assert!(spec_de("agy", "x", &launch("http")).is_err());
        assert!(spec_de("agy", "x", &launch("sse"))
            .unwrap_err()
            .contains("sse"));
    }

    fn http(nome: &str, url: &str) -> McpSpec {
        McpSpec {
            nome: nome.into(),
            alvo: McpAlvo::Http { url: url.into() },
            headers: vec![],
            env: vec![],
        }
    }

    #[test]
    fn escreve_a_entrada_na_forma_exata_do_schema_deles() {
        // `McpLocalConfig` e `McpRemoteConfig` são `additionalProperties:
        // false`: campo a mais é config INVÁLIDA, não campo ignorado.
        let saida =
            merge_opencode_json("", "mcx-a", Some(&stdio("mcx-a", "npx", &["srv"]))).unwrap();
        let v: serde_json::Value = serde_json::from_str(&saida).unwrap();
        assert_eq!(v["mcp"]["mcx-a"]["type"], "local");
        assert_eq!(v["mcp"]["mcx-a"]["command"][0], "npx");
        assert_eq!(v["mcp"]["mcx-a"]["command"][1], "srv");

        let saida =
            merge_opencode_json("", "mcx-b", Some(&http("mcx-b", "https://x/mcp"))).unwrap();
        let v: serde_json::Value = serde_json::from_str(&saida).unwrap();
        assert_eq!(v["mcp"]["mcx-b"]["type"], "remote");
        assert_eq!(v["mcp"]["mcx-b"]["url"], "https://x/mcp");
    }

    #[test]
    fn preserva_o_que_e_do_usuario_no_arquivo_do_repositorio() {
        let antes = r#"{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["algum-plugin@latest"],
  "mcp": { "meu-servidor": { "type": "local", "command": ["meu"] } }
}"#;
        let saida =
            merge_opencode_json(antes, "mcx-novo", Some(&http("mcx-novo", "https://x/mcp")))
                .unwrap();
        let v: serde_json::Value = serde_json::from_str(&saida).unwrap();
        // Chaves vizinhas intactas.
        assert_eq!(v["$schema"], "https://opencode.ai/config.json");
        assert_eq!(v["plugin"][0], "algum-plugin@latest");
        // MCP do usuário intacto, byte a byte no conteúdo.
        assert_eq!(v["mcp"]["meu-servidor"]["command"][0], "meu");
        // E o nosso entrou ao lado.
        assert_eq!(v["mcp"]["mcx-novo"]["type"], "remote");
    }

    #[test]
    fn remover_tira_so_o_nosso_e_nao_deixa_lixo() {
        let antes = r#"{"mcp":{"meu":{"type":"local","command":["m"]},"mcx-a":{"type":"remote","url":"https://x"}}}"#;
        let v: serde_json::Value =
            serde_json::from_str(&merge_opencode_json(antes, "mcx-a", None).unwrap()).unwrap();
        assert!(v["mcp"]["mcx-a"].is_null(), "o nosso saiu");
        assert_eq!(v["mcp"]["meu"]["command"][0], "m", "o do usuário ficou");

        // Quando só havia o nosso, a chave `mcp` sai junto: sem lixo no
        // arquivo de quem nos hospedou.
        let so_nosso = r#"{"$schema":"s","mcp":{"mcx-a":{"type":"remote","url":"https://x"}}}"#;
        let v: serde_json::Value =
            serde_json::from_str(&merge_opencode_json(so_nosso, "mcx-a", None).unwrap()).unwrap();
        assert!(v.get("mcp").is_none(), "chave vazia não fica: {v}");
        assert_eq!(v["$schema"], "s");
    }

    #[test]
    fn arquivo_com_comentario_faz_recusar_em_vez_de_apagar() {
        // O schema deles declara `allowComments`. Nenhum serializador JSON
        // preserva comentário, e este arquivo é do repositório do usuário:
        // gravar apagaria texto que ela escreveu e talvez versionou.
        let com = "{\n  // o servidor da equipe\n  \"mcp\": {}\n}";
        let erro =
            merge_opencode_json(com, "mcx-a", Some(&http("mcx-a", "https://x"))).unwrap_err();
        assert!(erro.contains("comentários"), "diz o motivo: {erro}");
        assert!(erro.contains("à mão"), "diz o que fazer: {erro}");
        assert!(merge_opencode_json("{\n  /* bloco */\n}", "mcx-a", None).is_err());
    }

    #[test]
    fn barra_dupla_dentro_de_string_nao_e_comentario() {
        // Toda URL https:// tem duas barras. Um detector ingênuo recusaria
        // gravar em praticamente todo arquivo real.
        let antes = r#"{"$schema":"https://opencode.ai/config.json","mcp":{"u":{"type":"remote","url":"https://x/mcp"}}}"#;
        assert!(!tem_comentario(antes));
        let saida = merge_opencode_json(antes, "mcx-a", Some(&http("mcx-a", "https://y"))).unwrap();
        assert!(saida.contains("mcx-a"));
        // E escape dentro de string também não confunde o varredor.
        assert!(!tem_comentario(r#"{"a":"diz \" e depois // nada"}"#));
    }

    #[test]
    fn json_invalido_nao_vira_arquivo_novo_por_cima() {
        // Arquivo quebrado é do usuário: sobrescrever seria destruir o que ele
        // estava editando. Só arquivo VAZIO nasce do zero.
        assert!(merge_opencode_json("{ isto não é json", "mcx-a", None).is_err());
        assert!(merge_opencode_json("   ", "mcx-a", Some(&http("mcx-a", "https://x"))).is_ok());
    }

    #[test]
    fn oauth_so_e_instalado_em_cli_que_sabe_autenticar() {
        // F5. O login do Frota NÃO viaja: o proxy do app é alcançado por
        // socket efêmero + o caminho do binário do Frota nesta máquina.
        // Nenhuma das duas coisas cabe num config que sobrevive ao run, e o
        // caminho do binário seria exatamente o "fixo aqui" proibido.
        let mut l = launch("http");
        l.url = Some("https://x/mcp".into());
        l.oauth = Some(crate::mcp_auth::OauthConfig {
            client_id: Some("c1".into()),
            callback_port: Some(8976),
            auth_server_metadata_url: None,
            resource: "https://x/mcp".into(),
        });

        // agy: a entrada que ele grava é serverUrl + headers + disabled, e o
        // `agy mcp` não tem subcomando de auth. Instalar ali daria um servidor
        // que falha na primeira chamada, com a tela dizendo "instalado".
        let erro = spec_de("agy", "prime", &l).unwrap_err();
        assert!(erro.contains("OAuth"), "diz a causa: {erro}");
        assert!(
            erro.contains("não viaja"),
            "diz por que o login não cobre: {erro}"
        );

        // opencode: tem `mcp auth|logout|debug` e campo `oauth` no schema.
        // Ali instalar é ajuda, não armadilha.
        assert!(spec_de("opencode", "prime", &l).is_ok());
    }

    #[test]
    fn sem_oauth_a_regra_do_f5_nao_atrapalha_ninguem() {
        // Guarda do outro lado: servidor comum continua instalável nos dois.
        let mut l = launch("http");
        l.url = Some("https://x/mcp".into());
        assert!(spec_de("agy", "simples", &l).is_ok());
        assert!(spec_de("opencode", "simples", &l).is_ok());
    }

    #[test]
    fn agent_fora_do_registry_nao_inventa_receita() {
        assert!(instalacao_de("aider").is_none());
        assert!(install_argv("aider", &stdio("x", "npx", &[])).is_none());
        assert!(uninstall_argv("aider", "x").is_none());
    }
}
