//! A tela de encerramento (ADR-235): depois que a pessoa confirma a saída, a
//! janela mostra o que a Frota está fechando e marca cada item quando ele
//! REALMENTE termina.
//!
//! Pedido de 23/09/2026: "quero ver que está encerrando os processos, e
//! quais". Antes o fechamento era mudo: sinal para todos, 750 ms de espera
//! fixa e força no que sobrasse, sem dizer o quê. A espera fixa também sai:
//! agora é "até tudo terminar, no máximo 750 ms".
//!
//! Estado real, nunca teatro: um item só vira "encerrado" quando o registro
//! dono dele diz que ele saiu; o que ainda estava de pé no fim da espera
//! aparece como "encerrado à força". Nada aqui inventa progresso.

use serde::Serialize;
use std::sync::Arc;
use tauri::Manager;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ItemDoEncerramento {
    /// Chave estável: `run:<id>`, `processo:<id>`, `plugin:<nome>`, ou o tipo.
    pub id: String,
    /// run, processo, plugin, ditado, analise, atualizacao, companion
    pub tipo: &'static str,
    /// O que a pessoa lê. Para run, a tela troca pelo título da conversa.
    pub rotulo: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conv_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MudancaDoItem {
    pub id: String,
    /// "encerrado" (saiu sozinho depois do sinal) ou "forcado" (ainda estava
    /// de pé no fim da espera).
    pub estado: &'static str,
}

/// O que está aberto agora e vai ser encerrado.
/// Os runs vivos agora, pelo id.
fn runs_vivos(app: &tauri::AppHandle) -> Vec<String> {
    app.state::<crate::agent::RunRegistry>()
        .0
        .lock()
        .map(|runs| runs.keys().cloned().collect())
        .unwrap_or_default()
}

pub(crate) async fn levantar(app: &tauri::AppHandle) -> Vec<ItemDoEncerramento> {
    let mut itens = Vec::new();
    for run_id in runs_vivos(app) {
        itens.push(ItemDoEncerramento {
            id: format!("run:{run_id}"),
            tipo: "run",
            rotulo: "Tarefa do agente".into(),
            run_id: Some(run_id),
            conv_id: None,
        });
    }
    for view in app
        .state::<Arc<crate::work_gateway::ProcessRegistry>>()
        .vivos()
    {
        let rotulo = if view.label.trim().is_empty() {
            view.command.chars().take(80).collect()
        } else {
            view.label.clone()
        };
        itens.push(ItemDoEncerramento {
            id: format!("processo:{}", view.id),
            tipo: "processo",
            rotulo,
            run_id: None,
            conv_id: (!view.conv_id.is_empty()).then(|| view.conv_id.clone()),
        });
    }
    for nome in app
        .state::<Arc<crate::plugin_runtime::PluginRuntimeRegistry>>()
        .ativos()
    {
        itens.push(ItemDoEncerramento {
            id: format!("plugin:{nome}"),
            tipo: "plugin",
            rotulo: format!("Plugin {nome}"),
            run_id: None,
            conv_id: None,
        });
    }
    let mut unico = |tipo: &'static str, rotulo: &str, ativo: bool| {
        if ativo {
            itens.push(ItemDoEncerramento {
                id: tipo.into(),
                tipo,
                rotulo: rotulo.into(),
                run_id: None,
                conv_id: None,
            });
        }
    };
    unico(
        "ditado",
        "Ditado em andamento",
        app.state::<crate::stt::SttSession>().active_count().await > 0,
    );
    unico(
        "analise",
        "Análise do modelo auxiliar",
        app.state::<Arc<crate::utility::UtilityState>>().active_count() > 0,
    );
    unico(
        "atualizacao",
        "Atualização em andamento",
        app.state::<Arc<crate::update::UpdateJobs>>().active_count() > 0,
    );
    unico(
        "companion",
        "Ação vinda do Companion",
        app.state::<crate::companion::CompanionState>().pending_action_count() > 0,
    );
    itens
}

/// O item ainda está de pé? Pergunta ao registro dono dele.
pub(crate) async fn vivo(app: &tauri::AppHandle, item: &ItemDoEncerramento) -> bool {
    match item.tipo {
        "run" => item
            .run_id
            .as_ref()
            .is_some_and(|id| runs_vivos(app).contains(id)),
        "processo" => {
            let id = item.id.trim_start_matches("processo:");
            app.state::<Arc<crate::work_gateway::ProcessRegistry>>()
                .vivos()
                .iter()
                .any(|view| view.id == id)
        }
        "plugin" => {
            let nome = item.id.trim_start_matches("plugin:");
            app.state::<Arc<crate::plugin_runtime::PluginRuntimeRegistry>>()
                .ativos()
                .iter()
                .any(|ativo| ativo == nome)
        }
        "ditado" => app.state::<crate::stt::SttSession>().active_count().await > 0,
        "analise" => app.state::<Arc<crate::utility::UtilityState>>().active_count() > 0,
        "atualizacao" => app.state::<Arc<crate::update::UpdateJobs>>().active_count() > 0,
        "companion" => app.state::<crate::companion::CompanionState>().pending_action_count() > 0,
        _ => false,
    }
}

/// Separa os que já saíram dos que seguem de pé. Puro, para teste.
pub(crate) fn separar<'a>(
    pendentes: Vec<&'a ItemDoEncerramento>,
    ainda_vivo: impl Fn(&ItemDoEncerramento) -> bool,
) -> (Vec<&'a ItemDoEncerramento>, Vec<&'a ItemDoEncerramento>) {
    pendentes.into_iter().partition(|item| !ainda_vivo(item))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str) -> ItemDoEncerramento {
        ItemDoEncerramento { id: id.into(), tipo: "processo", rotulo: id.into(), run_id: None, conv_id: None }
    }

    #[test]
    fn so_vira_encerrado_o_que_o_registro_diz_que_saiu() {
        let (a, b, c) = (item("processo:vite"), item("processo:chromium"), item("processo:api"));
        let (sairam, seguem) = separar(vec![&a, &b, &c], |i| i.id == "processo:chromium");
        assert_eq!(sairam.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), ["processo:vite", "processo:api"]);
        assert_eq!(seguem.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), ["processo:chromium"]);
    }

    #[test]
    fn o_item_vai_a_tela_em_camel_case_sem_campos_vazios() {
        let v = serde_json::to_value(ItemDoEncerramento {
            id: "run:r1".into(),
            tipo: "run",
            rotulo: "Tarefa do agente".into(),
            run_id: Some("r1".into()),
            conv_id: None,
        })
        .unwrap();
        assert_eq!(v, serde_json::json!({ "id": "run:r1", "tipo": "run", "rotulo": "Tarefa do agente", "runId": "r1" }));
    }
}
