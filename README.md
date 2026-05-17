# 📷 WiFi-Cam

Câmera IP pelo navegador. Funciona em qualquer rede (Wi-Fi, dados móveis, etc).

## Como funciona

```
[Celular - camera.html] ──WebRTC──> [Viewer - viewer.html]
                 ↕ sinalização via Socket.io
          [Servidor Node.js (público)]
```

WebRTC faz o stream **P2P** direto entre os dispositivos.  
O servidor só troca as mensagens de sinalização (SDP offer/answer + ICE).  
TURN server (Open Relay, gratuito) garante funcionamento entre redes diferentes.

---

## Deploy gratuito — Railway (recomendado)

1. Crie conta em [railway.app](https://railway.app)
2. Crie repositório no GitHub com este projeto
3. No Railway: **New Project → Deploy from GitHub repo**
4. Railway detecta o `package.json` automaticamente, deploy feito
5. Vá em **Settings → Networking → Generate Domain** → você recebe uma URL pública

Total: ~3 minutos.

---

## Deploy — Render

1. Crie conta em [render.com](https://render.com)
2. **New → Web Service → Connect GitHub repo**
3. Build command: `npm install`
4. Start command: `node server.js`
5. **Create Web Service** → URL pública gerada

---

## Deploy — Fly.io

```bash
npm install -g flyctl
fly auth login
fly launch      # detecta o Dockerfile automaticamente
fly deploy
```

---

## Rodar localmente (apenas rede local)

```bash
npm install
npm start
# Acesse http://SEU_IP:3000
```

> ⚠️ Localmente funciona só na mesma rede Wi-Fi.  
> Para acesso remoto, faça o deploy na nuvem.

---

## Como usar

| Dispositivo | URL | O que faz |
|---|---|---|
| Celular | `https://sua-url.railway.app/camera.html` | Transmite a câmera |
| PC / TV / outro celular | `https://sua-url.railway.app/viewer.html` | Assiste o stream |

1. Abra `camera.html` no celular → coloque o código da sala → **Iniciar Transmissão**
2. Abra `viewer.html` em qualquer dispositivo com qualquer conexão → mesmo código → **Conectar**
3. Pronto ✓

---

## TURN server próprio (opcional, produção)

O projeto usa o [Open Relay Project](https://openrelayproject.org/) por padrão (gratuito, sem cadastro).

Para produção pesada, crie conta grátis em [metered.ca](https://dashboard.metered.ca/signup) e substitua as credenciais ICE no `camera.html` e `viewer.html`:

```js
const ICE = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  {
    urls: 'turn:standard.relay.metered.ca:80',
    username: 'SEU_USERNAME',
    credential: 'SUA_CREDENTIAL'
  },
  // ... outros servidores do painel
];
```
