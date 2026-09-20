//! AVISO NO CELULAR COM A TELA FECHADA (Companion PRD A6).
//!
//! Até aqui o Companion só avisava com a página ABERTA (vibração e título
//! piscando, `index.html`). Com o Firefox fechado ou o aparelho bloqueado, o
//! pedido de aprovação esperava calado. Web Push resolve isso, e o preço está
//! escrito na ADR: o aviso passa pelo serviço de push do navegador (Mozilla, no
//! Android do usuário). O CONTEÚDO vai cifrado ponta a ponta por este módulo —
//! o serviço entrega bytes que só o aparelho abre.
//!
//! Duas metades, as duas implementadas aqui porque são pequenas e o teste é o
//! vetor da própria norma:
//!
//! * **RFC 8291** (Message Encryption for Web Push): ECDH P-256 com a chave
//!   pública do aparelho, HKDF-SHA256 e AES128GCM, no formato `aes128gcm` da
//!   RFC 8188 (cabeçalho com salt, tamanho de registro e a chave efêmera).
//! * **RFC 8292** (VAPID): JWT ES256 que identifica ESTE Mac para o serviço de
//!   push, com `aud` da origem do endpoint e validade curta.
//!
//! Nada aqui decide QUANDO avisar; isso é do `companion.rs`, que conhece o
//! estado da frota. Aqui é só "como o aviso viaja".

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes128Gcm, Nonce};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use hkdf::Hkdf;
use p256::ecdsa::signature::Signer;
use p256::ecdsa::{Signature, SigningKey};
use p256::elliptic_curve::sec1::ToSec1Point;
use p256::{PublicKey, SecretKey};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

/// Teto do corpo cifrado aceito pelos serviços de push. Uma mensagem nossa é de
/// centenas de bytes; o teto existe para falhar CEDO em vez de levar 413.
pub const MAX_PAYLOAD: usize = 3_800;
/// Tamanho de registro do `aes128gcm`. Um registro só: a mensagem é curta.
const RECORD_SIZE: u32 = 4_096;
/// Validade do JWT do VAPID. Curta de propósito: token vazado envelhece rápido.
const VAPID_TTL_S: u64 = 12 * 60 * 60;

/// A inscrição que o navegador do celular entregou (`PushSubscription`).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Subscricao {
    pub endpoint: String,
    /// Chave pública do aparelho (P-256 sem compressão), base64url.
    pub p256dh: String,
    /// Segredo de autenticação do aparelho, base64url.
    pub auth: String,
}

/// A chave pública em SEC1 sem compressão (`0x04 || X || Y`, 65 bytes).
fn sec1_sem_compressao(chave: &PublicKey) -> Vec<u8> {
    chave.to_sec1_point(false).as_bytes().to_vec()
}

fn b64d(s: &str) -> Result<Vec<u8>, String> {
    B64.decode(s.trim())
        .map_err(|e| format!("base64url inválido: {e}"))
}

/// Cifra o texto para UM aparelho, no formato `aes128gcm`.
///
/// `salt` e `efemera` entram por parâmetro porque é o que torna o vetor da RFC
/// reproduzível num teste; em produção os dois nascem aleatórios a cada envio,
/// como a norma exige (chave efêmera reusada quebraria o sigilo).
pub fn cifrar(
    sub: &Subscricao,
    texto: &[u8],
    salt: [u8; 16],
    efemera: &SecretKey,
) -> Result<Vec<u8>, String> {
    let ua_bytes = b64d(&sub.p256dh)?;
    let auth = b64d(&sub.auth)?;
    if auth.len() != 16 {
        return Err("segredo de autenticação do aparelho não tem 16 bytes".into());
    }
    let ua_pub = PublicKey::from_sec1_bytes(&ua_bytes)
        .map_err(|e| format!("chave pública do aparelho inválida: {e}"))?;

    // SEC1 sem compressão (65 bytes): é o que a RFC 8291 manda no cabeçalho e
    // o que o navegador entrega em `p256dh`.
    let as_bytes = sec1_sem_compressao(&efemera.public_key());

    // 1) segredo ECDH; 2) PRK com o segredo do aparelho como sal.
    let compartilhado = p256::ecdh::diffie_hellman(
        efemera.to_nonzero_scalar(),
        ua_pub.as_affine(),
    );
    let (_, prk_chave) = Hkdf::<Sha256>::extract(Some(&auth), compartilhado.raw_secret_bytes());

    // 3) IKM = HKDF-Expand(prk_chave, "WebPush: info" || ua_pub || as_pub, 32).
    let mut info = Vec::with_capacity(14 + 65 + 65);
    info.extend_from_slice(b"WebPush: info\0");
    info.extend_from_slice(&ua_bytes);
    info.extend_from_slice(&as_bytes);
    let mut ikm = [0u8; 32];
    prk_chave
        .expand(&info, &mut ikm)
        .map_err(|e| format!("HKDF do IKM falhou: {e}"))?;

    // 4) do IKM saem a chave e o nonce do registro.
    let (_, prk) = Hkdf::<Sha256>::extract(Some(&salt), &ikm);
    let mut cek = [0u8; 16];
    prk.expand(b"Content-Encoding: aes128gcm\0", &mut cek)
        .map_err(|e| format!("HKDF da chave falhou: {e}"))?;
    let mut nonce = [0u8; 12];
    prk.expand(b"Content-Encoding: nonce\0", &mut nonce)
        .map_err(|e| format!("HKDF do nonce falhou: {e}"))?;

    // 5) registro único: texto + delimitador 0x02 (RFC 8188 §2).
    let mut claro = texto.to_vec();
    claro.push(0x02);
    let cifra = Aes128Gcm::new_from_slice(&cek).map_err(|e| format!("chave AES inválida: {e}"))?;
    let cifrado = cifra
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &claro,
                aad: b"",
            },
        )
        .map_err(|_| "falha ao cifrar o aviso".to_string())?;

    // 6) cabeçalho da RFC 8188: salt | tamanho do registro | chave efêmera.
    let mut corpo = Vec::with_capacity(21 + as_bytes.len() + cifrado.len());
    corpo.extend_from_slice(&salt);
    corpo.extend_from_slice(&RECORD_SIZE.to_be_bytes());
    corpo.push(as_bytes.len() as u8);
    corpo.extend_from_slice(&as_bytes);
    corpo.extend_from_slice(&cifrado);
    if corpo.len() > MAX_PAYLOAD {
        return Err(format!(
            "aviso cifrado ficou com {} bytes, acima do teto de {MAX_PAYLOAD}",
            corpo.len()
        ));
    }
    Ok(corpo)
}

/// A origem do endpoint, que é o `aud` do JWT do VAPID.
pub fn origem_do_endpoint(endpoint: &str) -> Result<String, String> {
    let url = url::Url::parse(endpoint).map_err(|e| format!("endpoint inválido: {e}"))?;
    if url.scheme() != "https" {
        return Err("endpoint de push precisa ser https".into());
    }
    let host = url.host_str().ok_or("endpoint sem host")?;
    Ok(match url.port() {
        Some(p) => format!("https://{host}:{p}"),
        None => format!("https://{host}"),
    })
}

/// O cabeçalho `Authorization` do VAPID (RFC 8292, esquema `vapid`).
/// `contato` é o `sub` do JWT: `mailto:` ou `https:` que identifica quem envia.
pub fn autorizacao_vapid(
    endpoint: &str,
    contato: &str,
    chave: &SecretKey,
    agora_s: u64,
) -> Result<String, String> {
    let cabecalho = B64.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
    let corpo = B64.encode(
        serde_json::json!({
            "aud": origem_do_endpoint(endpoint)?,
            "exp": agora_s + VAPID_TTL_S,
            "sub": contato,
        })
        .to_string()
        .as_bytes(),
    );
    let assinando = format!("{cabecalho}.{corpo}");
    let assinatura: Signature = SigningKey::from(chave).sign(assinando.as_bytes());
    let jwt = format!("{assinando}.{}", B64.encode(assinatura.to_bytes()));
    let publica = B64.encode(sec1_sem_compressao(&chave.public_key()));
    Ok(format!("vapid t={jwt}, k={publica}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vetor da RFC 8291 §5. Conferido contra a implementação de referência
    /// `http_ece` (npm), que devolve exatamente este corpo para as mesmas
    /// entradas: o teste não é o nosso código conversando consigo mesmo.
    const UA_PUB: &str = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
    const AUTH: &str = "BTBZMqHH6r4Tts7J_aSIgg";
    const AS_PRIV: &str = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
    const SALT: &str = "DGv6ra1nlYgDCS1FRnbzlw";
    const ESPERADO: &str = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

    fn sub() -> Subscricao {
        Subscricao {
            endpoint: "https://push.example.net/aparelho/1".into(),
            p256dh: UA_PUB.into(),
            auth: AUTH.into(),
        }
    }

    fn efemera_do_vetor() -> SecretKey {
        SecretKey::from_slice(&B64.decode(AS_PRIV).unwrap()).unwrap()
    }

    fn salt_do_vetor() -> [u8; 16] {
        B64.decode(SALT).unwrap().try_into().unwrap()
    }

    #[test]
    fn cifra_igual_ao_vetor_da_rfc_8291() {
        let corpo = cifrar(
            &sub(),
            b"When I grow up, I want to be a watermelon",
            salt_do_vetor(),
            &efemera_do_vetor(),
        )
        .unwrap();
        assert_eq!(B64.encode(&corpo), ESPERADO);
    }

    #[test]
    fn o_cabecalho_carrega_salt_tamanho_e_a_chave_efemera() {
        let corpo = cifrar(&sub(), b"oi", salt_do_vetor(), &efemera_do_vetor()).unwrap();
        assert_eq!(&corpo[..16], &salt_do_vetor()[..]);
        assert_eq!(&corpo[16..20], &4_096u32.to_be_bytes()[..]);
        assert_eq!(corpo[20], 65, "chave efêmera sem compressão tem 65 bytes");
        // O texto claro nunca aparece no corpo.
        assert!(!corpo.windows(2).any(|j| j == b"oi"));
    }

    #[test]
    fn aparelho_com_chave_ou_segredo_estranho_falha_fechado() {
        let mut ruim = sub();
        ruim.p256dh = "nada-disso".into();
        assert!(cifrar(&ruim, b"x", salt_do_vetor(), &efemera_do_vetor()).is_err());

        let mut curto = sub();
        curto.auth = B64.encode([0u8; 8]);
        let erro = cifrar(&curto, b"x", salt_do_vetor(), &efemera_do_vetor()).unwrap_err();
        assert!(erro.contains("16 bytes"), "erro precisa dizer o que falta: {erro}");
    }

    #[test]
    fn aviso_grande_demais_falha_antes_de_sair_da_maquina() {
        let enorme = vec![b'a'; MAX_PAYLOAD];
        let erro = cifrar(&sub(), &enorme, salt_do_vetor(), &efemera_do_vetor()).unwrap_err();
        assert!(erro.contains("acima do teto"), "erro inesperado: {erro}");
    }

    #[test]
    fn a_origem_do_endpoint_vira_o_publico_do_jwt() {
        assert_eq!(
            origem_do_endpoint("https://updates.push.services.mozilla.com/wpush/v2/gAAA").unwrap(),
            "https://updates.push.services.mozilla.com"
        );
        assert_eq!(
            origem_do_endpoint("https://push.local:8443/x").unwrap(),
            "https://push.local:8443"
        );
        assert!(origem_do_endpoint("http://sem-tls.example/x").is_err());
    }

    #[test]
    fn a_autorizacao_vapid_leva_jwt_es256_e_a_chave_publica() {
        let chave = efemera_do_vetor();
        let cab = autorizacao_vapid(
            "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
            "mailto:frota@example.com",
            &chave,
            1_700_000_000,
        )
        .unwrap();
        let jwt = cab
            .strip_prefix("vapid t=")
            .and_then(|r| r.split_once(", k="))
            .expect("formato do cabeçalho");
        let partes: Vec<&str> = jwt.0.split('.').collect();
        assert_eq!(partes.len(), 3, "JWT tem três partes");
        let cabecalho: serde_json::Value =
            serde_json::from_slice(&B64.decode(partes[0]).unwrap()).unwrap();
        assert_eq!(cabecalho["alg"], "ES256");
        let corpo: serde_json::Value =
            serde_json::from_slice(&B64.decode(partes[1]).unwrap()).unwrap();
        assert_eq!(corpo["aud"], "https://updates.push.services.mozilla.com");
        assert_eq!(corpo["sub"], "mailto:frota@example.com");
        assert_eq!(corpo["exp"].as_u64().unwrap(), 1_700_000_000 + VAPID_TTL_S);
        // A chave que vai no `k=` é a pública da mesma chave que assinou.
        assert_eq!(
            jwt.1,
            B64.encode(sec1_sem_compressao(&chave.public_key()))
        );
    }
}

// ---------------- a chave deste Mac e o envio ----------------

const VAPID_FILE: &str = "companion-vapid.json";
/// Quem assina, para o serviço de push ter com quem falar se algo der errado.
/// `https:` do produto, não email pessoal: nada de dado do usuário aqui.
const CONTATO_VAPID: &str = "https://github.com/vinicius1209/mycockpit";

#[derive(Serialize, Deserialize)]
struct VapidGuardado {
    /// Chave privada P-256 em base64url (32 bytes).
    privada: String,
}

/// A chave VAPID deste Mac: nasce uma vez e fica em 0600, como o arquivo de
/// aparelhos. Trocar a chave invalidaria as inscrições já feitas, então ela é
/// estável por máquina.
pub fn chave_do_mac(dir: &std::path::Path) -> Result<SecretKey, String> {
    let caminho = dir.join(VAPID_FILE);
    if let Ok(texto) = std::fs::read_to_string(&caminho) {
        if let Ok(guardado) = serde_json::from_str::<VapidGuardado>(&texto) {
            if let Ok(bytes) = B64.decode(&guardado.privada) {
                if let Ok(chave) = SecretKey::from_slice(&bytes) {
                    return Ok(chave);
                }
            }
        }
        // Arquivo estragado: recria. Perder a chave custa reinscrever o
        // aparelho, o que é melhor do que o aviso parar de funcionar em
        // silêncio para sempre.
    }
    let nova = SecretKey::random(&mut rand::rng());
    let corpo = serde_json::to_string(&VapidGuardado {
        privada: B64.encode(nova.to_bytes()),
    })
    .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    crate::companion_rede::escrever_privado(&caminho, corpo.as_bytes())
        .map_err(|e| format!("não consegui guardar a chave de aviso: {e}"))?;
    Ok(nova)
}

/// A chave pública que o celular precisa para se inscrever (`applicationServerKey`).
pub fn chave_publica_b64(chave: &SecretKey) -> String {
    B64.encode(sec1_sem_compressao(&chave.public_key()))
}

/// O aviso, já pronto pelo lado do app (quem decide o texto é o front, que
/// conhece a frota; aqui só viaja).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Aviso {
    pub titulo: String,
    pub corpo: String,
    /// Para onde o toque na notificação leva, relativo à raiz do Companion.
    pub url: String,
    /// Avisos com a mesma `tag` se substituem no aparelho, em vez de empilhar.
    pub tag: String,
}

/// O que aconteceu com UM aparelho. Sem exceção silenciosa: quem chamou precisa
/// saber se o aviso saiu, e o 404/410 significa inscrição morta (o chamador
/// apaga).
#[derive(Debug, PartialEq)]
pub enum Entrega {
    Entregue,
    /// O serviço de push disse que essa inscrição não existe mais.
    InscricaoMorta,
    Falhou(String),
}

/// Manda UM aviso para UM aparelho. Salt e chave efêmera nascem aqui, novos a
/// cada envio, como a RFC 8291 exige.
pub async fn enviar(sub: &Subscricao, aviso: &Aviso, chave: &SecretKey, agora_s: u64) -> Entrega {
    let texto = match serde_json::to_vec(aviso) {
        Ok(t) => t,
        Err(e) => return Entrega::Falhou(format!("aviso não serializou: {e}")),
    };
    let mut salt = [0u8; 16];
    {
        use rand::Rng;
        rand::rng().fill_bytes(&mut salt);
    }
    let efemera = SecretKey::random(&mut rand::rng());
    let corpo = match cifrar(sub, &texto, salt, &efemera) {
        Ok(c) => c,
        Err(e) => return Entrega::Falhou(e),
    };
    let autorizacao = match autorizacao_vapid(&sub.endpoint, CONTATO_VAPID, chave, agora_s) {
        Ok(a) => a,
        Err(e) => return Entrega::Falhou(e),
    };
    let cliente = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return Entrega::Falhou(format!("cliente HTTP: {e}")),
    };
    let resposta = cliente
        .post(&sub.endpoint)
        .header("Authorization", autorizacao)
        .header("Content-Encoding", "aes128gcm")
        .header("Content-Type", "application/octet-stream")
        // 8 horas: se o celular estiver desligado mais que isso, o aviso já
        // não é notícia.
        .header("TTL", "28800")
        .header("Urgency", "normal")
        .body(corpo)
        .send()
        .await;
    match resposta {
        Ok(r) if r.status().is_success() => Entrega::Entregue,
        Ok(r) if r.status() == 404 || r.status() == 410 => Entrega::InscricaoMorta,
        Ok(r) => Entrega::Falhou(format!("serviço de push respondeu {}", r.status())),
        Err(e) => Entrega::Falhou(format!("não consegui falar com o serviço de push: {e}")),
    }
}
