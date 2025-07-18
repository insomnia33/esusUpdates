# Monitor de Atualizações e-SUS APS

Sistema automatizado para monitorar atualizações do e-SUS APS e API LEDI, enviando notificações por e-mail para usuários inscritos.

## Funcionalidades

- 🔍 **Monitoramento Automático**: Verifica diariamente o blog do e-SUS APS e a documentação da API LEDI
- 📧 **Notificações por E-mail**: Envia alertas automáticos quando novas atualizações são detectadas
- 🌐 **Interface Web**: Página simples e responsiva para inscrições
- ☁️ **Serverless**: Hospedado no Cloudflare Workers com custo zero
- 📱 **Responsivo**: Funciona perfeitamente em desktop e mobile
- 🛡️ **Tratamento de Erros**: Sistema robusto com retry automático e logs detalhados
- 📊 **Monitoramento**: Métricas de execução e endpoint de saúde

## Tecnologias

- **Backend**: Cloudflare Workers (JavaScript)
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Armazenamento**: Cloudflare KV
- **E-mail**: MailChannels API
- **Agendamento**: Cron Triggers

## Links Monitorados

1. **Blog e-SUS APS**: https://sisaps.saude.gov.br/sistemas/esusaps/blog/
2. **API LEDI**: https://integracao.esusab.ufsc.br/ledi/index.html

## Como Funciona

1. **Inscrição**: Usuários se inscrevem fornecendo seu e-mail
2. **Monitoramento**: Sistema verifica automaticamente as fontes todos os dias às 9h UTC (6h Brasília)
3. **Detecção**: Compara conteúdo atual com o último conhecido
4. **Notificação**: Envia e-mail para todos os inscritos quando há atualizações
5. **Recuperação**: Sistema tenta recuperação automática em caso de erros

## Estrutura do Projeto

```
├── worker.js          # Código principal do Cloudflare Worker
├── index.html         # Interface web
├── styles.css         # Estilos CSS
├── script.js          # JavaScript do frontend
├── wrangler.toml      # Configuração do Cloudflare Workers
├── deploy.js          # Script automatizado de deploy
├── test-system.js     # Testes de integração completos
├── validate-code.js   # Validação de código
└── README.md          # Este arquivo
```

## Instalação e Deploy

### Pré-requisitos

1. **Conta no Cloudflare** com Workers habilitado
2. **Node.js** (versão 16 ou superior)
3. **Wrangler CLI**: `npm install -g wrangler`
4. **Autenticação**: `wrangler login`

### Configuração Rápida

1. **Clone o repositório**
   ```bash
   git clone <repository-url>
   cd esus-monitor
   ```

2. **Validar código**
   ```bash
   node validate-code.js
   ```

3. **Configurar KV Namespace**
   ```bash
   # Criar namespace de desenvolvimento
   wrangler kv:namespace create "ESUS_MONITOR_KV" --env development
   
   # Criar namespace de produção
   wrangler kv:namespace create "ESUS_MONITOR_KV" --env production
   ```

4. **Atualizar wrangler.toml**
   - Substitua `your-dev-kv-namespace-id` e `your-production-kv-namespace-id` pelos IDs gerados

5. **Deploy automatizado**
   ```bash
   # Deploy para desenvolvimento
   node deploy.js development
   
   # Deploy para produção
   node deploy.js production
   ```

### Deploy Manual (Alternativo)

```bash
# Deploy para desenvolvimento
wrangler deploy --env development

# Deploy para produção
wrangler deploy --env production
```

## Testes

### Validação de Código (Offline)
```bash
node validate-code.js
```

### Testes de Integração (Requer worker rodando)
```bash
# Ajustar URL no test-system.js primeiro
node test-system.js
```

### Testes Manuais
1. Acesse a URL do worker
2. Teste inscrição com e-mail válido
3. Teste validação com e-mail inválido
4. Verifique endpoint `/health`
5. Monitore logs: `wrangler tail`

## Configuração

### Variáveis de Ambiente

```toml
# wrangler.toml
[[env.production.vars]]
ENVIRONMENT = "production"
LOG_LEVEL = "info"

[[env.development.vars]]
ENVIRONMENT = "development"
LOG_LEVEL = "debug"
```

### KV Namespaces

```toml
# Desenvolvimento
[env.development]
kv_namespaces = [
  { binding = "ESUS_MONITOR_KV", preview_id = "seu-dev-id" }
]

# Produção
[env.production]
kv_namespaces = [
  { binding = "ESUS_MONITOR_KV", id = "seu-production-id" }
]
```

### Cron Triggers

```toml
[triggers]
crons = ["0 9 * * *"]  # Diariamente às 9h UTC (6h Brasília)
```

## Endpoints da API

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/` | GET | Interface web principal |
| `/subscribe` | POST | Inscrição de e-mail |
| `/health` | GET | Status e métricas do sistema |
| `/styles.css` | GET | Arquivo CSS |
| `/script.js` | GET | Arquivo JavaScript |

### Exemplo de Uso da API

```javascript
// Inscrever e-mail
fetch('/subscribe', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'usuario@exemplo.com' })
});

// Verificar saúde do sistema
fetch('/health')
  .then(response => response.json())
  .then(data => console.log(data));
```

## Monitoramento e Logs

### Visualizar Logs em Tempo Real
```bash
wrangler tail
```

### Endpoint de Saúde
```bash
curl https://seu-worker.workers.dev/health
```

### Métricas Disponíveis
- Taxa de sucesso das execuções
- Duração média das verificações
- Número de inscritos
- Status das fontes monitoradas
- Logs de erro detalhados

## Tratamento de Erros

O sistema inclui:

- **Retry Automático**: 3 tentativas com backoff exponencial
- **Timeouts**: 15 segundos para operações de scraping
- **Recuperação**: Tentativa automática de recuperação após falhas
- **Logs Detalhados**: Registro completo de erros e métricas
- **Fallbacks**: Continuidade do serviço mesmo com falhas parciais

## Solução de Problemas

### Problemas Comuns

1. **Deploy falha**
   - Verifique autenticação: `wrangler whoami`
   - Confirme IDs do KV namespace no wrangler.toml

2. **E-mails não são enviados**
   - Verifique configuração do MailChannels
   - Confirme que o domínio está configurado corretamente

3. **Scraping falha**
   - Sites podem ter mudado estrutura
   - Verifique logs para detalhes específicos

4. **Cron não executa**
   - Confirme que triggers estão configurados
   - Verifique no dashboard do Cloudflare

### Debug

```bash
# Ver logs detalhados
wrangler tail --format pretty

# Testar localmente (desenvolvimento)
wrangler dev

# Verificar configuração
wrangler whoami
```

## Contribuição

1. Fork o projeto
2. Crie uma branch: `git checkout -b feature/nova-funcionalidade`
3. Valide o código: `node validate-code.js`
4. Commit: `git commit -m 'Adiciona nova funcionalidade'`
5. Push: `git push origin feature/nova-funcionalidade`
6. Abra um Pull Request

## Licença

Este projeto é de código aberto e está disponível sob a licença MIT.

## Aviso Legal

Este é um serviço não oficial de monitoramento. Os dados são obtidos dos sites oficiais do Ministério da Saúde através de web scraping público. O serviço é fornecido "como está" sem garantias de disponibilidade ou precisão.
