// Monitor de Atualizações do e-SUS APS - Cloudflare Worker
// Implementa scrapers, armazenamento KV e sistema de notificações

// Constantes para chaves do KV
const KV_KEYS = {
  EMAILS: 'subscriber_emails',
  LAST_BLOG_POST: 'last_blog_post',
  LAST_LEDI_VERSION: 'last_ledi_version',
  SYSTEM_STATUS: 'system_status',
  EXECUTION_METRICS: 'execution_metrics',
  ERROR_LOG: 'error_log'
};

// URLs das fontes monitoradas
const SOURCES = {
  BLOG: 'https://sisaps.saude.gov.br/sistemas/esusaps/blog/',
  LEDI: 'https://integracao.esusab.ufsc.br/ledi/index.html',
  LEDI_CHANGES: 'https://integracao.esusab.ufsc.br/ledi/documentacao/principais_alteracoes.html'
};

export default {
  // Handler para requisições HTTP
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const startTime = Date.now();
    
    try {
      console.log(`[${new Date().toISOString()}] ${request.method} ${url.pathname}`);
      
      // Roteamento principal
      if (request.method === 'POST' && url.pathname === '/subscribe') {
        const response = await handleSubscription(request, env);
        console.log(`[${new Date().toISOString()}] Subscription handled in ${Date.now() - startTime}ms`);
        return response;
      }
      
      if (request.method === 'GET' && url.pathname === '/health') {
        const response = await handleHealthCheck(env);
        console.log(`[${new Date().toISOString()}] Health check in ${Date.now() - startTime}ms`);
        return response;
      }
      
      // Servir frontend estático
      const response = await serveStaticFiles(url.pathname);
      console.log(`[${new Date().toISOString()}] Static file served in ${Date.now() - startTime}ms`);
      return response;
      
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Erro crítico no worker:`, {
        error: error.message,
        stack: error.stack,
        url: url.pathname,
        method: request.method,
        duration: Date.now() - startTime
      });
      
      return new Response(
        JSON.stringify({ 
          error: 'Erro interno do servidor',
          timestamp: new Date().toISOString(),
          requestId: crypto.randomUUID()
        }), 
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  },

  // Handler para execução agendada (cron)
  async scheduled(event, env, ctx) {
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] Iniciando verificação agendada de atualizações`);
    
    try {
      const result = await checkForUpdates(env);
      const duration = Date.now() - startTime;
      
      console.log(`[${new Date().toISOString()}] Verificação concluída em ${duration}ms:`, {
        hasUpdates: result.hasUpdates,
        notifications: result.notifications.length,
        status: result.status
      });
      
      // Armazenar métricas de execução
      await storeExecutionMetrics(env, {
        timestamp: new Date().toISOString(),
        duration,
        success: true,
        updates: result.notifications.length,
        status: result.status
      });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[${new Date().toISOString()}] Erro crítico na verificação agendada:`, {
        error: error.message,
        stack: error.stack,
        duration
      });
      
      // Armazenar métricas de erro
      await storeExecutionMetrics(env, {
        timestamp: new Date().toISOString(),
        duration,
        success: false,
        error: error.message,
        status: { blogStatus: 'error', lediStatus: 'error', emailStatus: 'error' }
      });
      
      // Tentar recuperação automática em caso de erro
      await attemptRecovery(env, error);
    }
  }
};

// Função para processar inscrições de e-mail
async function handleSubscription(request, env) {
  try {
    const { email } = await request.json();
    
    // Validar e-mail
    if (!isValidEmail(email)) {
      return new Response(
        JSON.stringify({ error: 'E-mail inválido' }), 
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    const normalizedEmail = normalizeEmail(email);
    
    // Verificar se e-mail já existe
    const existingEmails = await getStoredEmails(env);
    if (existingEmails.has(normalizedEmail)) {
      return new Response(
        JSON.stringify({ message: 'E-mail já está inscrito' }), 
        { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    // Adicionar e-mail à lista
    existingEmails.add(normalizedEmail);
    await storeEmails(env, existingEmails);
    
    // Enviar e-mail de confirmação
    try {
      const latestUpdates = await getLatestUpdatesData(env);
      const emailSent = await sendConfirmationEmail(normalizedEmail, latestUpdates);
      
      if (!emailSent) {
        console.warn(`Falha ao enviar e-mail de confirmação para: ${normalizedEmail}`);
      } else {
        console.log(`E-mail de confirmação enviado para: ${normalizedEmail}`);
      }
    } catch (error) {
      console.error('Erro ao enviar e-mail de confirmação:', error);
    }
    
    console.log(`Novo e-mail inscrito: ${normalizedEmail}`);
    
    return new Response(
      JSON.stringify({ message: 'Inscrição realizada com sucesso! Verifique seu e-mail.' }), 
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
  } catch (error) {
    console.error('Erro ao processar inscrição:', error);
    return new Response(
      JSON.stringify({ error: 'Erro ao processar inscrição' }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Função para verificar saúde do sistema
async function handleHealthCheck(env) {
  try {
    const detailedHealth = await getDetailedSystemHealth(env);
    
    // Determinar status HTTP baseado na saúde do sistema
    const httpStatus = detailedHealth.status === 'error' ? 503 : 200;
    
    return new Response(
      JSON.stringify(detailedHealth), 
      { 
        status: httpStatus,
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        }
      }
    );
  } catch (error) {
    await storeErrorLog(env, error, { endpoint: '/health' });
    
    return new Response(
      JSON.stringify({ 
        status: 'error', 
        message: error.message,
        timestamp: new Date().toISOString()
      }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Função para servir arquivos estáticos do frontend
async function serveStaticFiles(pathname) {
  // Mapear caminhos para arquivos
  const fileMap = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/styles.css': 'styles.css',
    '/script.js': 'script.js'
  };
  
  const filename = fileMap[pathname];
  if (!filename) {
    return new Response('Arquivo não encontrado', { status: 404 });
  }
  
  // Determinar Content-Type
  const contentTypes = {
    'html': 'text/html; charset=utf-8',
    'css': 'text/css; charset=utf-8',
    'js': 'application/javascript; charset=utf-8'
  };
  
  const extension = filename.split('.').pop();
  const contentType = contentTypes[extension] || 'text/plain';
  
  try {
    // Servir arquivos estáticos reais
    if (filename === 'index.html') {
      return new Response(getIndexHtml(), { 
        headers: { 'Content-Type': contentType }
      });
    } else if (filename === 'styles.css') {
      return new Response(getStylesCss(), { 
        headers: { 'Content-Type': contentType }
      });
    } else if (filename === 'script.js') {
      return new Response(getScriptJs(), { 
        headers: { 'Content-Type': contentType }
      });
    }
    
    return new Response('Arquivo não encontrado', { status: 404 });
    
  } catch (error) {
    console.error('Erro ao servir arquivo estático:', error);
    return new Response('Erro interno do servidor', { status: 500 });
  }
}
// 
===== FUNÇÕES DE SCRAPING =====

// Scraper para o blog do e-SUS APS
async function getLatestBlogPost() {
  const maxRetries = 3;
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[${new Date().toISOString()}] Tentativa ${attempt}/${maxRetries} - Scraping blog e-SUS`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
      
      const response = await fetch(SOURCES.BLOG, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; e-SUS Monitor/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      let latestPost = {
        title: null,
        link: null,
        extractedAt: new Date().toISOString(),
        attempt
      };
      
      // Usar HTMLRewriter para extrair o primeiro post da sidebar
      const rewriter = new HTMLRewriter()
        .on('div.sidebarItemList_Yudw a:first-of-type', {
          element(element) {
            try {
              const title = element.getAttribute('title') || '';
              const href = element.getAttribute('href') || '';
              
              if (title && href) {
                latestPost.title = title.trim();
                latestPost.link = href.startsWith('http') ? href : `https://sisaps.saude.gov.br${href}`;
              }
            } catch (elementError) {
              console.warn('Erro ao processar elemento do blog:', elementError);
            }
          }
        })
        .on('div.sidebarItemList_Yudw a:first-of-type span', {
          text(text) {
            try {
              if (!latestPost.title && text.text && text.text.trim()) {
                latestPost.title = text.text.trim();
              }
            } catch (textError) {
              console.warn('Erro ao processar texto do blog:', textError);
            }
          }
        });
      
      await rewriter.transform(response);
      
      // Validar dados extraídos
      if (!latestPost.title || latestPost.title.length < 3) {
        throw new Error('Título do post não encontrado ou inválido');
      }
      
      if (!latestPost.link || !latestPost.link.startsWith('http')) {
        throw new Error('Link do post não encontrado ou inválido');
      }
      
      console.log(`[${new Date().toISOString()}] ✅ Blog scraping bem-sucedido: "${latestPost.title}"`);
      return latestPost;
      
    } catch (error) {
      lastError = error;
      console.error(`[${new Date().toISOString()}] ❌ Tentativa ${attempt} falhou:`, error.message);
      
      // Se não é a última tentativa, aguardar antes de tentar novamente
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Backoff exponencial
        console.log(`Aguardando ${delay}ms antes da próxima tentativa...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // Se chegou aqui, todas as tentativas falharam
  const finalError = new Error(`Falha no scraping do blog após ${maxRetries} tentativas: ${lastError?.message}`);
  finalError.originalError = lastError;
  finalError.attempts = maxRetries;
  throw finalError;
}

// Scraper para a API LEDI
async function getLatestLediVersion() {
  const maxRetries = 3;
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[${new Date().toISOString()}] Tentativa ${attempt}/${maxRetries} - Scraping LEDI`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
      
      const response = await fetch(SOURCES.LEDI, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; e-SUS Monitor/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      let latestVersion = {
        version: null,
        changes: null,
        extractedAt: new Date().toISOString(),
        attempt
      };
      
      let isFirstRow = true;
      
      // Usar HTMLRewriter para extrair a primeira versão da tabela
      const rewriter = new HTMLRewriter()
        .on('table tbody tr td:first-child', {
          text(text) {
            try {
              if (isFirstRow && text.text && text.text.trim()) {
                latestVersion.version = text.text.trim();
                isFirstRow = false;
              }
            } catch (textError) {
              console.warn('Erro ao processar texto da LEDI:', textError);
            }
          }
        });
      
      await rewriter.transform(response);
      
      // Validar dados extraídos
      if (!latestVersion.version || latestVersion.version.length < 1) {
        throw new Error('Versão da LEDI não encontrada ou inválida');
      }
      
      // Buscar alterações da versão (com fallback)
      try {
        latestVersion.changes = await getLediChanges();
      } catch (changesError) {
        console.warn(`Erro ao buscar alterações da LEDI (tentativa ${attempt}):`, changesError.message);
        latestVersion.changes = 'Alterações não disponíveis no momento';
      }
      
      console.log(`[${new Date().toISOString()}] ✅ LEDI scraping bem-sucedido: versão "${latestVersion.version}"`);
      return latestVersion;
      
    } catch (error) {
      lastError = error;
      console.error(`[${new Date().toISOString()}] ❌ Tentativa ${attempt} falhou:`, error.message);
      
      // Se não é a última tentativa, aguardar antes de tentar novamente
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Backoff exponencial
        console.log(`Aguardando ${delay}ms antes da próxima tentativa...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // Se chegou aqui, todas as tentativas falharam
  const finalError = new Error(`Falha no scraping da LEDI após ${maxRetries} tentativas: ${lastError?.message}`);
  finalError.originalError = lastError;
  finalError.attempts = maxRetries;
  throw finalError;
}

// Buscar alterações da LEDI (versão simplificada)
async function getLediChanges() {
  try {
    const response = await fetch(SOURCES.LEDI_CHANGES, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; e-SUS Monitor/1.0)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Erro ao acessar alterações LEDI: ${response.status}`);
    }
    
    let changes = '';
    
    // Extrair conteúdo principal da página de alterações
    const rewriter = new HTMLRewriter()
      .on('body', {
        text(text) {
          changes += text.text;
        }
      });
    
    await rewriter.transform(response);
    
    // Limitar tamanho para evitar e-mails muito grandes
    return changes.substring(0, 2000) + (changes.length > 2000 ? '...' : '');
    
  } catch (error) {
    console.error('Erro ao buscar alterações da LEDI:', error);
    return 'Não foi possível obter as alterações desta versão.';
  }
}

// ===== FUNÇÕES DE COMPARAÇÃO =====

// Verificar se há novo post no blog
function hasNewBlogPost(current, stored) {
  if (!stored || !stored.title || !stored.link) {
    return true;
  }
  
  return current.title !== stored.title || current.link !== stored.link;
}

// Verificar se há nova versão da LEDI
function hasNewLediVersion(current, stored) {
  if (!stored || !stored.version) {
    return true;
  }
  
  return current.version !== stored.version;
}

// ===== FUNÇÕES DE ARMAZENAMENTO KV =====

// Obter lista de e-mails armazenados
async function getStoredEmails(env) {
  try {
    const emailsJson = await env.ESUS_MONITOR_KV.get(KV_KEYS.EMAILS);
    if (!emailsJson) {
      return new Set();
    }
    
    const emailsArray = JSON.parse(emailsJson);
    return new Set(emailsArray);
    
  } catch (error) {
    console.error('Erro ao obter e-mails armazenados:', error);
    return new Set();
  }
}

// Armazenar lista de e-mails
async function storeEmails(env, emailsSet) {
  try {
    const emailsArray = Array.from(emailsSet);
    await env.ESUS_MONITOR_KV.put(KV_KEYS.EMAILS, JSON.stringify(emailsArray));
    return true;
  } catch (error) {
    console.error('Erro ao armazenar e-mails:', error);
    return false;
  }
}

// Obter último post do blog armazenado
async function getStoredBlogPost(env) {
  try {
    const postJson = await env.ESUS_MONITOR_KV.get(KV_KEYS.LAST_BLOG_POST);
    return postJson ? JSON.parse(postJson) : null;
  } catch (error) {
    console.error('Erro ao obter último post do blog:', error);
    return null;
  }
}

// Armazenar último post do blog
async function storeBlogPost(env, blogPost) {
  try {
    await env.ESUS_MONITOR_KV.put(KV_KEYS.LAST_BLOG_POST, JSON.stringify(blogPost));
    return true;
  } catch (error) {
    console.error('Erro ao armazenar post do blog:', error);
    return false;
  }
}

// Obter última versão da LEDI armazenada
async function getStoredLediVersion(env) {
  try {
    const versionJson = await env.ESUS_MONITOR_KV.get(KV_KEYS.LAST_LEDI_VERSION);
    return versionJson ? JSON.parse(versionJson) : null;
  } catch (error) {
    console.error('Erro ao obter última versão da LEDI:', error);
    return null;
  }
}

// Armazenar última versão da LEDI
async function storeLediVersion(env, lediVersion) {
  try {
    await env.ESUS_MONITOR_KV.put(KV_KEYS.LAST_LEDI_VERSION, JSON.stringify(lediVersion));
    return true;
  } catch (error) {
    console.error('Erro ao armazenar versão da LEDI:', error);
    return false;
  }
}

// Obter status do sistema
async function getSystemStatus(env) {
  try {
    const statusJson = await env.ESUS_MONITOR_KV.get(KV_KEYS.SYSTEM_STATUS);
    if (!statusJson) {
      return {
        lastCheck: null,
        blogStatus: 'unknown',
        lediStatus: 'unknown',
        emailStatus: 'unknown'
      };
    }
    
    return JSON.parse(statusJson);
  } catch (error) {
    console.error('Erro ao obter status do sistema:', error);
    return {
      lastCheck: null,
      blogStatus: 'error',
      lediStatus: 'error',
      emailStatus: 'error'
    };
  }
}

// Armazenar status do sistema
async function storeSystemStatus(env, status) {
  try {
    await env.ESUS_MONITOR_KV.put(KV_KEYS.SYSTEM_STATUS, JSON.stringify(status));
    return true;
  } catch (error) {
    console.error('Erro ao armazenar status do sistema:', error);
    return false;
  }
}/
/ ===== FUNÇÕES DE VALIDAÇÃO =====

// Validar formato de e-mail
function isValidEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  
  // Regex simples mas eficaz para validação de e-mail
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

// Normalizar e-mail (lowercase e trim)
function normalizeEmail(email) {
  return email.toLowerCase().trim();
}

// ===== FUNÇÃO PRINCIPAL DE VERIFICAÇÃO DE ATUALIZAÇÕES =====

// Verificar atualizações nas duas fontes
async function checkForUpdates(env) {
  const status = {
    lastCheck: new Date().toISOString(),
    blogStatus: 'ok',
    lediStatus: 'ok',
    emailStatus: 'ok'
  };
  
  let hasUpdates = false;
  let notifications = [];
  
  try {
    // Verificar blog do e-SUS APS
    console.log('Verificando atualizações do blog...');
    
    try {
      const currentBlogPost = await getLatestBlogPost();
      const storedBlogPost = await getStoredBlogPost(env);
      
      if (hasNewBlogPost(currentBlogPost, storedBlogPost)) {
        console.log('Nova postagem detectada no blog:', currentBlogPost.title);
        
        await storeBlogPost(env, currentBlogPost);
        hasUpdates = true;
        
        notifications.push({
          type: 'blog',
          data: currentBlogPost
        });
      } else {
        console.log('Nenhuma nova postagem no blog');
      }
      
    } catch (error) {
      console.error('Erro ao verificar blog:', error);
      status.blogStatus = 'error';
    }
    
    // Verificar API LEDI
    console.log('Verificando atualizações da LEDI...');
    
    try {
      const currentLediVersion = await getLatestLediVersion();
      const storedLediVersion = await getStoredLediVersion(env);
      
      if (hasNewLediVersion(currentLediVersion, storedLediVersion)) {
        console.log('Nova versão da LEDI detectada:', currentLediVersion.version);
        
        await storeLediVersion(env, currentLediVersion);
        hasUpdates = true;
        
        notifications.push({
          type: 'ledi',
          data: currentLediVersion
        });
      } else {
        console.log('Nenhuma nova versão da LEDI');
      }
      
    } catch (error) {
      console.error('Erro ao verificar LEDI:', error);
      status.lediStatus = 'error';
    }
    
    // Se há atualizações, enviar notificações por e-mail
    if (hasUpdates && notifications.length > 0) {
      console.log(`${notifications.length} atualização(ões) detectada(s)`);
      
      try {
        const emailsSent = await sendNotificationEmails(env, notifications);
        console.log(`Notificações enviadas para ${emailsSent} usuários`);
        
        if (emailsSent === 0) {
          status.emailStatus = 'warning';
        }
      } catch (error) {
        console.error('Erro ao enviar notificações:', error);
        status.emailStatus = 'error';
      }
    }
    
  } catch (error) {
    console.error('Erro geral na verificação de atualizações:', error);
    status.emailStatus = 'error';
  }
  
  // Atualizar status do sistema
  await storeSystemStatus(env, status);
  
  return {
    hasUpdates,
    notifications,
    status
  };
}

// ===== FUNÇÕES AUXILIARES =====

// Função para obter dados das últimas atualizações (para e-mail de confirmação)
async function getLatestUpdatesData(env) {
  try {
    const blogPost = await getStoredBlogPost(env);
    const lediVersion = await getStoredLediVersion(env);
    
    return {
      blog: blogPost || { title: 'Nenhuma postagem encontrada', link: '#' },
      ledi: lediVersion || { version: 'Nenhuma versão encontrada', changes: '' }
    };
    
  } catch (error) {
    console.error('Erro ao obter dados das últimas atualizações:', error);
    return {
      blog: { title: 'Erro ao carregar', link: '#' },
      ledi: { version: 'Erro ao carregar', changes: '' }
    };
  }
}

// Função para contar número de inscritos
async function getSubscriberCount(env) {
  try {
    const emails = await getStoredEmails(env);
    return emails.size;
  } catch (error) {
    console.error('Erro ao contar inscritos:', error);
    return 0;
  }
}

// Função para limpar dados (útil para manutenção)
async function clearAllData(env) {
  try {
    await env.ESUS_MONITOR_KV.delete(KV_KEYS.EMAILS);
    await env.ESUS_MONITOR_KV.delete(KV_KEYS.LAST_BLOG_POST);
    await env.ESUS_MONITOR_KV.delete(KV_KEYS.LAST_LEDI_VERSION);
    await env.ESUS_MONITOR_KV.delete(KV_KEYS.SYSTEM_STATUS);
    
    console.log('Todos os dados foram limpos');
    return true;
  } catch (error) {
    console.error('Erro ao limpar dados:', error);
    return false;
  }
}

// ===== SISTEMA DE E-MAIL - MAILCHANNELS =====

// Classe para gerenciar envio de e-mails via MailChannels
class EmailService {
  constructor() {
    this.apiUrl = 'https://api.mailchannels.net/tx/v1/send';
    this.fromEmail = 'noreply@esus-monitor.workers.dev';
    this.fromName = 'Monitor e-SUS APS';
  }

  // Enviar e-mail usando MailChannels API
  async sendEmail(to, subject, htmlContent) {
    try {
      const payload = {
        personalizations: [
          {
            to: [{ email: to }]
          }
        ],
        from: {
          email: this.fromEmail,
          name: this.fromName
        },
        subject: subject,
        content: [
          {
            type: 'text/html',
            value: htmlContent
          }
        ]
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Erro MailChannels (${response.status}):`, errorText);
        return false;
      }

      return true;

    } catch (error) {
      console.error('Erro ao enviar e-mail:', error);
      return false;
    }
  }
}

// ===== TEMPLATES DE E-MAIL =====

// Template base para e-mails
function getEmailTemplate(title, content) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            border-bottom: 2px solid #2563eb;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .header h1 {
            color: #2563eb;
            margin: 0;
            font-size: 24px;
        }
        .content {
            margin-bottom: 30px;
        }
        .update-box {
            background-color: #f8fafc;
            border-left: 4px solid #2563eb;
            padding: 15px;
            margin: 15px 0;
        }
        .update-title {
            font-weight: bold;
            color: #1e40af;
            margin-bottom: 8px;
        }
        .link {
            color: #2563eb;
            text-decoration: none;
        }
        .link:hover {
            text-decoration: underline;
        }
        .footer {
            text-align: center;
            font-size: 12px;
            color: #666;
            border-top: 1px solid #e5e7eb;
            padding-top: 20px;
            margin-top: 30px;
        }
        .button {
            display: inline-block;
            background-color: #2563eb;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏥 Monitor e-SUS APS</h1>
        </div>
        <div class="content">
            ${content}
        </div>
        <div class="footer">
            <p>Este é um serviço automatizado de monitoramento das atualizações do e-SUS APS.</p>
            <p>Você está recebendo este e-mail porque se inscreveu para receber notificações.</p>
        </div>
    </div>
</body>
</html>`;
}

// Template para e-mail de confirmação
function getConfirmationEmailContent(latestUpdates) {
  const blogUpdate = latestUpdates.blog;
  const lediUpdate = latestUpdates.ledi;

  return `
    <h2>✅ Inscrição confirmada!</h2>
    <p>Obrigado por se inscrever no Monitor e-SUS APS! Você agora receberá notificações automáticas sempre que houver atualizações.</p>
    
    <h3>📋 O que monitoramos:</h3>
    <ul>
        <li><strong>Blog e-SUS APS:</strong> Novas postagens e notícias</li>
        <li><strong>API LEDI:</strong> Novas versões e documentação</li>
    </ul>

    <h3>🔄 Últimas atualizações conhecidas:</h3>
    
    <div class="update-box">
        <div class="update-title">📝 Blog e-SUS APS</div>
        <p><strong>Último post:</strong> ${blogUpdate.title}</p>
        ${blogUpdate.link !== '#' ? `<p><a href="${blogUpdate.link}" class="link">Ver postagem completa →</a></p>` : ''}
    </div>

    <div class="update-box">
        <div class="update-title">🔧 API LEDI</div>
        <p><strong>Versão atual:</strong> ${lediUpdate.version}</p>
        ${lediUpdate.changes && lediUpdate.changes !== 'Alterações não disponíveis' ? 
          `<p><strong>Principais alterações:</strong></p><p style="font-size: 14px; color: #666;">${lediUpdate.changes.substring(0, 300)}${lediUpdate.changes.length > 300 ? '...' : ''}</p>` : 
          ''
        }
    </div>

    <p>🔔 <strong>Próximos passos:</strong> Você receberá um e-mail sempre que detectarmos novas atualizações em qualquer uma dessas fontes.</p>
  `;
}

// Template para notificação de atualização do blog
function getBlogNotificationContent(blogPost) {
  return `
    <h2>📝 Nova postagem no Blog e-SUS APS!</h2>
    <p>Uma nova postagem foi publicada no blog oficial do e-SUS APS:</p>
    
    <div class="update-box">
        <div class="update-title">📄 ${blogPost.title}</div>
        <p>Publicado em: ${new Date(blogPost.extractedAt).toLocaleDateString('pt-BR')}</p>
        <a href="${blogPost.link}" class="button">Ler postagem completa</a>
    </div>

    <p>Acesse o link acima para ler a postagem completa e ficar por dentro das novidades do e-SUS APS.</p>
  `;
}

// Template para notificação de atualização da LEDI
function getLediNotificationContent(lediVersion) {
  return `
    <h2>🔧 Nova versão da API LEDI disponível!</h2>
    <p>Uma nova versão da API LEDI foi detectada:</p>
    
    <div class="update-box">
        <div class="update-title">🆕 Versão ${lediVersion.version}</div>
        <p>Detectada em: ${new Date(lediVersion.extractedAt).toLocaleDateString('pt-BR')}</p>
        
        ${lediVersion.changes && lediVersion.changes !== 'Alterações não disponíveis' ? 
          `<p><strong>Principais alterações:</strong></p>
           <div style="background-color: #f1f5f9; padding: 15px; border-radius: 6px; font-size: 14px; color: #475569;">
             ${lediVersion.changes}
           </div>` : 
          '<p><em>Detalhes das alterações não disponíveis no momento.</em></p>'
        }
        
        <a href="https://integracao.esusab.ufsc.br/ledi/index.html" class="button">Ver documentação completa</a>
    </div>

    <p>Recomendamos que você verifique a documentação completa para entender todas as mudanças desta nova versão.</p>
  `;
}

// Template para notificação consolidada (múltiplas atualizações)
function getConsolidatedNotificationContent(notifications) {
  let content = `
    <h2>🔔 Múltiplas atualizações detectadas!</h2>
    <p>Detectamos ${notifications.length} nova(s) atualização(ões) hoje:</p>
  `;

  notifications.forEach((notification, index) => {
    if (notification.type === 'blog') {
      content += `
        <div class="update-box">
          <div class="update-title">📝 Nova postagem no Blog</div>
          <p><strong>${notification.data.title}</strong></p>
          <a href="${notification.data.link}" class="link">Ler postagem →</a>
        </div>
      `;
    } else if (notification.type === 'ledi') {
      content += `
        <div class="update-box">
          <div class="update-title">🔧 Nova versão da API LEDI</div>
          <p><strong>Versão ${notification.data.version}</strong></p>
          <a href="https://integracao.esusab.ufsc.br/ledi/index.html" class="link">Ver documentação →</a>
        </div>
      `;
    }
  });

  content += `<p>Clique nos links acima para acessar as atualizações completas.</p>`;
  
  return content;
}

// ===== FUNÇÕES DE ENVIO DE E-MAIL =====

// Enviar e-mail de confirmação
async function sendConfirmationEmail(email, latestUpdates) {
  try {
    const emailService = new EmailService();
    const subject = '✅ Confirmação de inscrição - Monitor e-SUS APS';
    const content = getConfirmationEmailContent(latestUpdates);
    const htmlContent = getEmailTemplate(subject, content);

    const success = await emailService.sendEmail(email, subject, htmlContent);
    
    if (success) {
      console.log(`E-mail de confirmação enviado para: ${email}`);
    } else {
      console.error(`Falha ao enviar e-mail de confirmação para: ${email}`);
    }

    return success;

  } catch (error) {
    console.error('Erro ao enviar e-mail de confirmação:', error);
    return false;
  }
}

// Enviar notificações para todos os usuários inscritos
async function sendNotificationEmails(env, notifications) {
  try {
    const emails = await getStoredEmails(env);
    const emailList = Array.from(emails);
    
    if (emailList.length === 0) {
      console.log('Nenhum usuário inscrito para enviar notificações');
      return 0;
    }

    const emailService = new EmailService();
    let emailsSent = 0;

    // Se há múltiplas atualizações, enviar e-mail consolidado
    if (notifications.length > 1) {
      const subject = `🔔 ${notifications.length} novas atualizações do e-SUS APS!`;
      const content = getConsolidatedNotificationContent(notifications);
      const htmlContent = getEmailTemplate(subject, content);

      for (const email of emailList) {
        try {
          const success = await emailService.sendEmail(email, subject, htmlContent);
          if (success) {
            emailsSent++;
          }
          
          // Pequeno delay para evitar rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          console.error(`Erro ao enviar para ${email}:`, error);
        }
      }
    } else {
      // Enviar e-mail específico para cada tipo de atualização
      for (const notification of notifications) {
        let subject, content;

        if (notification.type === 'blog') {
          subject = '📝 Nova postagem no e-SUS APS!';
          content = getBlogNotificationContent(notification.data);
        } else if (notification.type === 'ledi') {
          subject = '🔧 Nova versão da API LEDI!';
          content = getLediNotificationContent(notification.data);
        } else {
          continue; // Pular notificações de tipo desconhecido
        }

        const htmlContent = getEmailTemplate(subject, content);

        for (const email of emailList) {
          try {
            const success = await emailService.sendEmail(email, subject, htmlContent);
            if (success) {
              emailsSent++;
            }
            
            // Pequeno delay para evitar rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
            
          } catch (error) {
            console.error(`Erro ao enviar para ${email}:`, error);
          }
        }
      }
    }

    console.log(`Notificações enviadas: ${emailsSent}/${emailList.length * notifications.length} e-mails`);
    return emailsSent;

  } catch (error) {
    console.error('Erro ao enviar notificações:', error);
    return 0;
  }
}o 
ao enviar notificações:', error);
    return 0;
  }
}

// ===== FUNÇÕES PARA SERVIR ARQUIVOS ESTÁTICOS =====

// Gerar conteúdo do index.html
function getIndexHtml() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Monitor e-SUS APS - Notificações Automáticas</title>
    <meta name="description" content="Receba notificações automáticas sobre atualizações do e-SUS APS e API LEDI">
    <link rel="stylesheet" href="/styles.css">
</head>
<body>
    <div class="container">
        <header class="header">
            <h1>🏥 Monitor e-SUS APS</h1>
            <p class="subtitle">Receba notificações automáticas sobre atualizações</p>
        </header>

        <main class="main">
            <section class="info-section">
                <h2>📋 O que monitoramos</h2>
                <div class="monitored-links">
                    <div class="link-card">
                        <h3>📝 Blog e-SUS APS</h3>
                        <p>Novas postagens e notícias oficiais</p>
                        <a href="https://sisaps.saude.gov.br/sistemas/esusaps/blog/" target="_blank" rel="noopener" class="external-link">
                            Visitar Blog →
                        </a>
                    </div>
                    <div class="link-card">
                        <h3>🔧 API LEDI</h3>
                        <p>Novas versões e documentação técnica</p>
                        <a href="https://integracao.esusab.ufsc.br/ledi/index.html" target="_blank" rel="noopener" class="external-link">
                            Ver Documentação →
                        </a>
                    </div>
                </div>
            </section>

            <section class="subscription-section">
                <h2>✉️ Inscreva-se para receber notificações</h2>
                <p>Digite seu e-mail abaixo e receba alertas automáticos sempre que houver atualizações:</p>
                
                <form id="subscriptionForm" class="subscription-form">
                    <div class="form-group">
                        <label for="email" class="sr-only">Seu e-mail</label>
                        <input 
                            type="email" 
                            id="email" 
                            name="email" 
                            placeholder="seu@email.com" 
                            required 
                            class="email-input"
                        >
                        <button type="submit" class="subscribe-btn" id="subscribeBtn">
                            <span class="btn-text">Inscrever-se</span>
                            <span class="btn-loading" style="display: none;">Enviando...</span>
                        </button>
                    </div>
                </form>

                <div id="feedback" class="feedback" style="display: none;"></div>
            </section>

            <section class="how-it-works">
                <h2>🔄 Como funciona</h2>
                <div class="steps">
                    <div class="step">
                        <div class="step-number">1</div>
                        <div class="step-content">
                            <h3>Inscreva-se</h3>
                            <p>Digite seu e-mail e confirme a inscrição</p>
                        </div>
                    </div>
                    <div class="step">
                        <div class="step-number">2</div>
                        <div class="step-content">
                            <h3>Monitoramento</h3>
                            <p>Verificamos diariamente por atualizações</p>
                        </div>
                    </div>
                    <div class="step">
                        <div class="step-number">3</div>
                        <div class="step-content">
                            <h3>Notificação</h3>
                            <p>Você recebe um e-mail com as novidades</p>
                        </div>
                    </div>
                </div>
            </section>
        </main>

        <footer class="footer">
            <p>Serviço não oficial de monitoramento • Desenvolvido para a comunidade e-SUS</p>
            <p>Este serviço monitora fontes públicas e não tem afiliação oficial com o Ministério da Saúde</p>
        </footer>
    </div>

    <script src="/script.js"></script>
</body>
</html>`;
}

// Gerar conteúdo do styles.css
function getStylesCss() {
  return `/* Reset e base */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    line-height: 1.6;
    color: #1f2937;
    background-color: #f9fafb;
}

.container {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
}

/* Header */
.header {
    text-align: center;
    margin-bottom: 3rem;
    padding: 2rem 0;
    background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
    color: white;
    border-radius: 12px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.header h1 {
    font-size: 2.5rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
}

.subtitle {
    font-size: 1.1rem;
    opacity: 0.9;
}

/* Main content */
.main {
    display: flex;
    flex-direction: column;
    gap: 3rem;
}

/* Info section */
.info-section h2 {
    font-size: 1.5rem;
    margin-bottom: 1.5rem;
    color: #1f2937;
}

.monitored-links {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2rem;
}

.link-card {
    background: white;
    padding: 1.5rem;
    border-radius: 8px;
    box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
    border: 1px solid #e5e7eb;
    transition: transform 0.2s, box-shadow 0.2s;
}

.link-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.link-card h3 {
    font-size: 1.2rem;
    margin-bottom: 0.5rem;
    color: #1f2937;
}

.link-card p {
    color: #6b7280;
    margin-bottom: 1rem;
}

.external-link {
    color: #2563eb;
    text-decoration: none;
    font-weight: 500;
    transition: color 0.2s;
}

.external-link:hover {
    color: #1d4ed8;
    text-decoration: underline;
}

/* Subscription section */
.subscription-section {
    background: white;
    padding: 2rem;
    border-radius: 12px;
    box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
    border: 1px solid #e5e7eb;
}

.subscription-section h2 {
    font-size: 1.5rem;
    margin-bottom: 1rem;
    color: #1f2937;
}

.subscription-section p {
    color: #6b7280;
    margin-bottom: 1.5rem;
}

.subscription-form {
    margin-bottom: 1rem;
}

.form-group {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
}

.email-input {
    flex: 1;
    min-width: 250px;
    padding: 0.75rem 1rem;
    border: 2px solid #e5e7eb;
    border-radius: 6px;
    font-size: 1rem;
    transition: border-color 0.2s, box-shadow 0.2s;
}

.email-input:focus {
    outline: none;
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.email-input:invalid {
    border-color: #ef4444;
}

.subscribe-btn {
    padding: 0.75rem 1.5rem;
    background: #2563eb;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s, transform 0.1s;
    min-width: 120px;
}

.subscribe-btn:hover:not(:disabled) {
    background: #1d4ed8;
    transform: translateY(-1px);
}

.subscribe-btn:disabled {
    background: #9ca3af;
    cursor: not-allowed;
    transform: none;
}

.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}

/* Feedback messages */
.feedback {
    padding: 1rem;
    border-radius: 6px;
    margin-top: 1rem;
    font-weight: 500;
}

.feedback.success {
    background-color: #dcfce7;
    color: #166534;
    border: 1px solid #bbf7d0;
}

.feedback.error {
    background-color: #fef2f2;
    color: #dc2626;
    border: 1px solid #fecaca;
}

.feedback.info {
    background-color: #dbeafe;
    color: #1e40af;
    border: 1px solid #bfdbfe;
}

/* How it works section */
.how-it-works h2 {
    font-size: 1.5rem;
    margin-bottom: 1.5rem;
    color: #1f2937;
}

.steps {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1.5rem;
}

.step {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 1.5rem;
    background: white;
    border-radius: 8px;
    box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
    border: 1px solid #e5e7eb;
}

.step-number {
    flex-shrink: 0;
    width: 2rem;
    height: 2rem;
    background: #2563eb;
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 0.9rem;
}

.step-content h3 {
    font-size: 1.1rem;
    margin-bottom: 0.5rem;
    color: #1f2937;
}

.step-content p {
    color: #6b7280;
    font-size: 0.9rem;
}

/* Footer */
.footer {
    text-align: center;
    margin-top: 3rem;
    padding: 2rem 0;
    color: #6b7280;
    font-size: 0.9rem;
    border-top: 1px solid #e5e7eb;
}

.footer p {
    margin-bottom: 0.5rem;
}

/* Responsive design */
@media (max-width: 768px) {
    .container {
        padding: 15px;
    }
    
    .header {
        margin-bottom: 2rem;
        padding: 1.5rem 1rem;
    }
    
    .header h1 {
        font-size: 2rem;
    }
    
    .main {
        gap: 2rem;
    }
    
    .monitored-links {
        grid-template-columns: 1fr;
        gap: 1rem;
    }
    
    .subscription-section {
        padding: 1.5rem;
    }
    
    .form-group {
        flex-direction: column;
    }
    
    .email-input {
        min-width: auto;
    }
    
    .steps {
        grid-template-columns: 1fr;
        gap: 1rem;
    }
    
    .step {
        padding: 1rem;
    }
}

@media (max-width: 480px) {
    .container {
        padding: 10px;
    }
    
    .header h1 {
        font-size: 1.8rem;
    }
    
    .subtitle {
        font-size: 1rem;
    }
    
    .link-card, .subscription-section, .step {
        padding: 1rem;
    }
}

/* Loading animation */
@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.btn-loading::after {
    content: '';
    display: inline-block;
    width: 1rem;
    height: 1rem;
    border: 2px solid transparent;
    border-top: 2px solid currentColor;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-left: 0.5rem;
}`;
}

// Gerar conteúdo do script.js
function getScriptJs() {
  return `// Monitor e-SUS APS - Frontend JavaScript
// Gerencia o formulário de inscrição e feedback do usuário

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('subscriptionForm');
    const emailInput = document.getElementById('email');
    const subscribeBtn = document.getElementById('subscribeBtn');
    const btnText = subscribeBtn.querySelector('.btn-text');
    const btnLoading = subscribeBtn.querySelector('.btn-loading');
    const feedback = document.getElementById('feedback');

    // Submissão do formulário
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const email = emailInput.value.trim();
        
        // Validação básica
        if (!email || !isValidEmail(email)) {
            showFeedback('Por favor, digite um e-mail válido.', 'error');
            return;
        }

        // Mostrar estado de carregamento
        setLoadingState(true);
        hideFeedback();

        try {
            const response = await fetch('/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email: email })
            });

            const data = await response.json();

            if (response.ok) {
                // Sucesso
                showFeedback(data.message || 'Inscrição realizada com sucesso!', 'success');
                form.reset();
                
                // Scroll suave para o feedback
                feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                
            } else {
                // Erro do servidor
                showFeedback(data.error || 'Erro ao processar inscrição. Tente novamente.', 'error');
            }

        } catch (error) {
            console.error('Erro na requisição:', error);
            showFeedback('Erro de conexão. Verifique sua internet e tente novamente.', 'error');
        } finally {
            setLoadingState(false);
        }
    });

    // Validação em tempo real do e-mail
    emailInput.addEventListener('input', function() {
        const email = this.value.trim();
        
        if (email && !isValidEmail(email)) {
            this.style.borderColor = '#ef4444';
        } else {
            this.style.borderColor = '#e5e7eb';
        }
        
        // Limpar feedback quando usuário começar a digitar
        if (feedback.style.display !== 'none') {
            hideFeedback();
        }
    });

    // Limpar validação visual quando campo receber foco
    emailInput.addEventListener('focus', function() {
        this.style.borderColor = '#2563eb';
    });

    // Restaurar borda padrão quando campo perder foco
    emailInput.addEventListener('blur', function() {
        if (!this.value.trim()) {
            this.style.borderColor = '#e5e7eb';
        }
    });

    // Funções auxiliares
    function isValidEmail(email) {
        const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
        return emailRegex.test(email);
    }

    function setLoadingState(loading) {
        subscribeBtn.disabled = loading;
        
        if (loading) {
            btnText.style.display = 'none';
            btnLoading.style.display = 'inline';
        } else {
            btnText.style.display = 'inline';
            btnLoading.style.display = 'none';
        }
    }

    function showFeedback(message, type) {
        feedback.textContent = message;
        feedback.className = \`feedback \${type}\`;
        feedback.style.display = 'block';
        
        // Auto-hide success messages after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                hideFeedback();
            }, 5000);
        }
    }

    function hideFeedback() {
        feedback.style.display = 'none';
        feedback.className = 'feedback';
    }

    // Adicionar efeitos visuais aos cards
    const linkCards = document.querySelectorAll('.link-card');
    linkCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-4px)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(-2px)';
        });
    });

    // Smooth scroll para links internos (se houver)
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Adicionar indicador visual para links externos
    document.querySelectorAll('a[target="_blank"]').forEach(link => {
        link.addEventListener('click', function() {
            // Pequeno feedback visual
            this.style.transform = 'scale(0.98)';
            setTimeout(() => {
                this.style.transform = 'scale(1)';
            }, 100);
        });
    });

    // Melhorar acessibilidade - adicionar navegação por teclado
    document.addEventListener('keydown', function(e) {
        // Enter no campo de e-mail submete o formulário
        if (e.key === 'Enter' && document.activeElement === emailInput) {
            form.dispatchEvent(new Event('submit'));
        }
        
        // Escape esconde feedback
        if (e.key === 'Escape' && feedback.style.display !== 'none') {
            hideFeedback();
        }
    });

    // Detectar se usuário está offline
    window.addEventListener('online', function() {
        if (feedback.textContent.includes('conexão')) {
            showFeedback('Conexão restaurada. Você pode tentar novamente.', 'info');
        }
    });

    window.addEventListener('offline', function() {
        showFeedback('Você está offline. Verifique sua conexão com a internet.', 'error');
    });

    // Log para debugging (apenas em desenvolvimento)
    if (window.location.hostname === 'localhost' || window.location.hostname.includes('127.0.0.1')) {
        console.log('Monitor e-SUS APS - Frontend carregado');
        console.log('Formulário:', form);
        console.log('Campo de e-mail:', emailInput);
    }
});

// Função global para testar a API (útil para debugging)
window.testSubscription = async function(email) {
    try {
        const response = await fetch('/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email: email || 'test@example.com' })
        });
        
        const data = await response.json();
        console.log('Resposta da API:', data);
        return data;
    } catch (error) {
        console.error('Erro no teste:', error);
        return { error: error.message };
    }
};

// Função global para verificar status do sistema
window.checkSystemHealth = async function() {
    try {
        const response = await fetch('/health');
        const data = await response.json();
        console.log('Status do sistema:', data);
        return data;
    } catch (error) {
        console.error('Erro ao verificar status:', error);
        return { error: error.message };
    }
};`;

// ===== FUNÇÕES DE TRATAMENTO DE ERROS E MÉTRICAS =====

// Armazenar métricas de execução
async function storeExecutionMetrics(env, metrics) {
  try {
    // Obter métricas existentes
    const existingMetricsJson = await env.ESUS_MONITOR_KV.get(KV_KEYS.EXECUTION_METRICS);
    let metricsHistory = [];
    
    if (existingMetricsJson) {
      metricsHistory = JSON.parse(existingMetricsJson);
    }
    
    // Adicionar nova métrica
    metricsHistory.push(metrics);
    
    // Manter apenas as últimas 50 execuções
    if (metricsHistory.length > 50) {
      metricsHistory = metricsHistory.slice(-50);
    }
    
    await env.ESUS_MONITOR_KV.put(KV_KEYS.EXECUTION_METRICS, JSON.stringify(metricsHistory));
    return true;
    
  } catch (error) {
    console.error('Erro ao armazenar métricas:', error);
    return false;
  }
}

// Obter métricas de execução
async function getExecutionMetrics(env) {
  try {
    const metricsJson = await env.ESUS_MONITOR_KV.get(KV_KEYS.EXECUTION_METRICS);
    return metricsJson ? JSON.parse(metricsJson) : [];
  } catch (error) {
    console.error('Erro ao obter métricas:', error);
    return [];
  }
}

// Armazenar log de erros
async function storeErrorLog(env, error, context = {}) {
  try {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      message: error.message,
      stack: error.stack,
      context,
      id: crypto.randomUUID()
    };
    
    // Obter logs existentes
    const existingLogsJson = await env.ESUS_MONITOR_KV.get(KV_KEYS.ERROR_LOG);
    let errorLogs = [];
    
    if (existingLogsJson) {
      errorLogs = JSON.parse(existingLogsJson);
    }
    
    // Adicionar novo erro
    errorLogs.push(errorEntry);
    
    // Manter apenas os últimos 100 erros
    if (errorLogs.length > 100) {
      errorLogs = errorLogs.slice(-100);
    }
    
    await env.ESUS_MONITOR_KV.put(KV_KEYS.ERROR_LOG, JSON.stringify(errorLogs));
    
    console.error(`[${errorEntry.timestamp}] Erro registrado:`, errorEntry);
    return errorEntry.id;
    
  } catch (storeError) {
    console.error('Erro ao armazenar log de erro:', storeError);
    return null;
  }
}

// Tentar recuperação automática em caso de erro
async function attemptRecovery(env, error) {
  console.log(`[${new Date().toISOString()}] Iniciando tentativa de recuperação automática`);
  
  try {
    // Armazenar erro no log
    await storeErrorLog(env, error, { 
      type: 'scheduled_execution',
      recovery_attempt: true 
    });
    
    // Verificar se é um erro de rede temporário
    if (error.message.includes('fetch') || error.message.includes('network')) {
      console.log('Erro de rede detectado - aguardando antes de nova tentativa');
      
      // Aguardar 30 segundos e tentar novamente (apenas uma vez)
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      try {
        console.log('Tentando recuperação com nova verificação...');
        const result = await checkForUpdates(env);
        
        if (result.status.blogStatus === 'ok' || result.status.lediStatus === 'ok') {
          console.log('Recuperação parcial bem-sucedida');
          return true;
        }
      } catch (recoveryError) {
        console.error('Falha na tentativa de recuperação:', recoveryError);
        await storeErrorLog(env, recoveryError, { 
          type: 'recovery_attempt',
          original_error: error.message 
        });
      }
    }
    
    // Atualizar status do sistema para indicar erro
    await storeSystemStatus(env, {
      lastCheck: new Date().toISOString(),
      blogStatus: 'error',
      lediStatus: 'error',
      emailStatus: 'error',
      lastError: error.message,
      recoveryAttempted: true
    });
    
    return false;
    
  } catch (recoveryError) {
    console.error('Erro durante tentativa de recuperação:', recoveryError);
    return false;
  }
}

// Função para verificar saúde do sistema com métricas detalhadas
async function getDetailedSystemHealth(env) {
  try {
    const status = await getSystemStatus(env);
    const metrics = await getExecutionMetrics(env);
    const subscriberCount = await getSubscriberCount(env);
    
    // Calcular estatísticas das últimas execuções
    const recentMetrics = metrics.slice(-10); // Últimas 10 execuções
    const successRate = recentMetrics.length > 0 
      ? (recentMetrics.filter(m => m.success).length / recentMetrics.length) * 100 
      : 0;
    
    const avgDuration = recentMetrics.length > 0
      ? recentMetrics.reduce((sum, m) => sum + m.duration, 0) / recentMetrics.length
      : 0;
    
    return {
      ...status,
      metrics: {
        totalExecutions: metrics.length,
        recentSuccessRate: Math.round(successRate),
        averageDuration: Math.round(avgDuration),
        subscriberCount
      },
      lastExecution: metrics.length > 0 ? metrics[metrics.length - 1] : null
    };
    
  } catch (error) {
    console.error('Erro ao obter saúde detalhada do sistema:', error);
    return {
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Função para limpar logs antigos (manutenção)
async function cleanupOldLogs(env) {
  try {
    console.log('Iniciando limpeza de logs antigos...');
    
    // Limpar métricas antigas (manter apenas últimas 30)
    const metrics = await getExecutionMetrics(env);
    if (metrics.length > 30) {
      const recentMetrics = metrics.slice(-30);
      await env.ESUS_MONITOR_KV.put(KV_KEYS.EXECUTION_METRICS, JSON.stringify(recentMetrics));
      console.log(`Métricas limpas: ${metrics.length - 30} entradas removidas`);
    }
    
    // Limpar logs de erro antigos (manter apenas últimos 50)
    const errorLogsJson = await env.ESUS_MONITOR_KV.get(KV_KEYS.ERROR_LOG);
    if (errorLogsJson) {
      const errorLogs = JSON.parse(errorLogsJson);
      if (errorLogs.length > 50) {
        const recentErrors = errorLogs.slice(-50);
        await env.ESUS_MONITOR_KV.put(KV_KEYS.ERROR_LOG, JSON.stringify(recentErrors));
        console.log(`Logs de erro limpos: ${errorLogs.length - 50} entradas removidas`);
      }
    }
    
    console.log('Limpeza de logs concluída');
    return true;
    
  } catch (error) {
    console.error('Erro durante limpeza de logs:', error);
    return false;
  }
}

// Função para validar integridade dos dados
async function validateDataIntegrity(env) {
  const issues = [];
  
  try {
    // Verificar e-mails
    const emails = await getStoredEmails(env);
    const invalidEmails = Array.from(emails).filter(email => !isValidEmail(email));
    if (invalidEmails.length > 0) {
      issues.push(`E-mails inválidos encontrados: ${invalidEmails.length}`);
    }
    
    // Verificar último post do blog
    const blogPost = await getStoredBlogPost(env);
    if (blogPost && (!blogPost.title || !blogPost.link)) {
      issues.push('Dados do blog incompletos');
    }
    
    // Verificar última versão da LEDI
    const lediVersion = await getStoredLediVersion(env);
    if (lediVersion && !lediVersion.version) {
      issues.push('Dados da LEDI incompletos');
    }
    
    // Verificar status do sistema
    const status = await getSystemStatus(env);
    if (!status.lastCheck) {
      issues.push('Status do sistema não inicializado');
    }
    
    return {
      isValid: issues.length === 0,
      issues,
      checkedAt: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Erro ao validar integridade dos dados:', error);
    return {
      isValid: false,
      issues: [`Erro na validação: ${error.message}`],
      checkedAt: new Date().toISOString()
    };
  }
}

// ===== FUNÇÕES DE TESTE E DEBUGGING =====

// Função para testar scrapers individualmente
async function testScrapers() {
  const results = {
    blog: { success: false, data: null, error: null, duration: 0 },
    ledi: { success: false, data: null, error: null, duration: 0 }
  };
  
  // Testar scraper do blog
  const blogStart = Date.now();
  try {
    results.blog.data = await getLatestBlogPost();
    results.blog.success = true;
    results.blog.duration = Date.now() - blogStart;
    console.log('✅ Scraper do blog funcionando:', results.blog.data.title);
  } catch (error) {
    results.blog.error = error.message;
    results.blog.duration = Date.now() - blogStart;
    console.error('❌ Erro no scraper do blog:', error.message);
  }
  
  // Testar scraper da LEDI
  const lediStart = Date.now();
  try {
    results.ledi.data = await getLatestLediVersion();
    results.ledi.success = true;
    results.ledi.duration = Date.now() - lediStart;
    console.log('✅ Scraper da LEDI funcionando:', results.ledi.data.version);
  } catch (error) {
    results.ledi.error = error.message;
    results.ledi.duration = Date.now() - lediStart;
    console.error('❌ Erro no scraper da LEDI:', error.message);
  }
  
  return results;
}

// Função para testar envio de e-mail
async function testEmailService(testEmail = 'test@example.com') {
  try {
    const emailService = new EmailService();
    const testContent = `
      <h2>🧪 E-mail de Teste</h2>
      <p>Este é um e-mail de teste do Monitor e-SUS APS.</p>
      <p>Enviado em: ${new Date().toLocaleString('pt-BR')}</p>
    `;
    
    const success = await emailService.sendEmail(
      testEmail,
      '🧪 Teste - Monitor e-SUS APS',
      getEmailTemplate('Teste', testContent)
    );
    
    return {
      success,
      email: testEmail,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Erro no teste de e-mail:', error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Função para executar todos os testes
async function runAllTests(env, testEmail = null) {
  console.log('🧪 Iniciando bateria de testes completa...');
  
  const testResults = {
    timestamp: new Date().toISOString(),
    scrapers: null,
    email: null,
    dataIntegrity: null,
    systemHealth: null
  };
  
  // Testar scrapers
  console.log('Testando scrapers...');
  testResults.scrapers = await testScrapers();
  
  // Testar e-mail (se fornecido)
  if (testEmail) {
    console.log('Testando serviço de e-mail...');
    testResults.email = await testEmailService(testEmail);
  }
  
  // Testar integridade dos dados
  console.log('Validando integridade dos dados...');
  testResults.dataIntegrity = await validateDataIntegrity(env);
  
  // Obter saúde do sistema
  console.log('Verificando saúde do sistema...');
  testResults.systemHealth = await getDetailedSystemHealth(env);
  
  console.log('🧪 Testes concluídos');
  return testResults;
}
/
/ ===== FUNÇÕES PARA SERVIR ARQUIVOS ESTÁTICOS =====

// Função para retornar o conteúdo do index.html
function getIndexHtml() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Monitor de Atualizações e-SUS APS</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <header class="header">
            <h1>Monitor de Atualizações e-SUS APS</h1>
            <p class="subtitle">Receba notificações automáticas sobre atualizações do e-SUS APS e API LEDI</p>
        </header>

        <section class="monitored-links">
            <h2>Links Monitorados</h2>
            <div class="links-grid">
                <div class="link-card">
                    <h3>Blog e-SUS APS</h3>
                    <p>Notícias e atualizações oficiais</p>
                    <a href="https://sisaps.saude.gov.br/sistemas/esusaps/blog/" target="_blank" rel="noopener">
                        Visitar Blog
                    </a>
                </div>
                <div class="link-card">
                    <h3>API LEDI</h3>
                    <p>Documentação e versões da API</p>
                    <a href="https://integracao.esusab.ufsc.br/ledi/index.html" target="_blank" rel="noopener">
                        Visitar Documentação
                    </a>
                </div>
            </div>
        </section>

        <section class="subscription">
            <h2>Inscrever-se para Notificações</h2>
            <form id="subscriptionForm" class="subscription-form">
                <div class="form-group">
                    <label for="email">E-mail:</label>
                    <input 
                        type="email" 
                        id="email" 
                        name="email" 
                        placeholder="seu@email.com" 
                        required
                        autocomplete="email"
                    >
                </div>
                <button type="submit" id="submitBtn" class="submit-btn">
                    <span class="btn-text">Inscrever-se</span>
                    <span class="btn-loading" style="display: none;">Processando...</span>
                </button>
            </form>
            
            <div id="feedback" class="feedback" style="display: none;">
                <div id="feedbackMessage" class="feedback-message"></div>
            </div>
        </section>

        <footer class="footer">
            <p>Serviço não oficial de monitoramento. Dados obtidos dos sites oficiais do Ministério da Saúde.</p>
        </footer>
    </div>

    <script src="script.js"></script>
</body>
</html>`;
}

// Função para retornar o conteúdo do styles.css
function getStylesCss() {
  return `/* Reset e configurações básicas */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

:root {
    --primary-color: #2563eb;
    --primary-hover: #1d4ed8;
    --success-color: #16a34a;
    --warning-color: #d97706;
    --error-color: #dc2626;
    --text-color: #1f2937;
    --text-light: #6b7280;
    --bg-color: #ffffff;
    --bg-light: #f9fafb;
    --border-color: #e5e7eb;
    --border-radius: 8px;
    --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
    --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    line-height: 1.6;
    color: var(--text-color);
    background-color: var(--bg-light);
}

.container {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
}

/* Header */
.header {
    text-align: center;
    margin-bottom: 40px;
    padding: 40px 20px;
    background: linear-gradient(135deg, var(--primary-color), var(--primary-hover));
    color: white;
    border-radius: var(--border-radius);
    box-shadow: var(--shadow-lg);
}

.header h1 {
    font-size: 2.5rem;
    font-weight: 700;
    margin-bottom: 10px;
}

.subtitle {
    font-size: 1.1rem;
    opacity: 0.9;
    max-width: 600px;
    margin: 0 auto;
}

/* Links monitorados */
.monitored-links {
    margin-bottom: 40px;
}

.monitored-links h2 {
    font-size: 1.5rem;
    margin-bottom: 20px;
    color: var(--text-color);
    text-align: center;
}

.links-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 20px;
    margin-bottom: 30px;
}

.link-card {
    background: var(--bg-color);
    padding: 25px;
    border-radius: var(--border-radius);
    box-shadow: var(--shadow);
    border: 1px solid var(--border-color);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.link-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-lg);
}

.link-card h3 {
    color: var(--primary-color);
    margin-bottom: 10px;
    font-size: 1.2rem;
}

.link-card p {
    color: var(--text-light);
    margin-bottom: 15px;
}

.link-card a {
    display: inline-block;
    color: var(--primary-color);
    text-decoration: none;
    font-weight: 500;
    padding: 8px 16px;
    border: 1px solid var(--primary-color);
    border-radius: 4px;
    transition: all 0.2s ease;
}

.link-card a:hover {
    background-color: var(--primary-color);
    color: white;
}

/* Seção de inscrição */
.subscription {
    background: var(--bg-color);
    padding: 30px;
    border-radius: var(--border-radius);
    box-shadow: var(--shadow);
    border: 1px solid var(--border-color);
}

.subscription h2 {
    font-size: 1.5rem;
    margin-bottom: 20px;
    color: var(--text-color);
    text-align: center;
}

.subscription-form {
    max-width: 400px;
    margin: 0 auto;
}

.form-group {
    margin-bottom: 20px;
    position: relative;
}

.form-group label {
    display: block;
    margin-bottom: 8px;
    font-weight: 500;
    color: var(--text-color);
}

.form-group input {
    width: 100%;
    padding: 12px 16px;
    border: 2px solid var(--border-color);
    border-radius: var(--border-radius);
    font-size: 16px;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
    background-color: var(--bg-color);
}

.form-group input:focus {
    outline: none;
    border-color: var(--primary-color);
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.form-group input.valid {
    border-color: var(--success-color);
    box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.1);
}

.form-group input.invalid {
    border-color: var(--error-color);
    box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1);
}

.submit-btn {
    width: 100%;
    padding: 14px 24px;
    background-color: var(--primary-color);
    color: white;
    border: none;
    border-radius: var(--border-radius);
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.2s ease, transform 0.1s ease;
    position: relative;
}

.submit-btn:hover:not(:disabled) {
    background-color: var(--primary-hover);
    transform: translateY(-1px);
}

.submit-btn:active {
    transform: translateY(0);
}

.submit-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
}

.submit-btn.loading .btn-text {
    display: none;
}

.submit-btn.loading .btn-loading {
    display: inline !important;
}

/* Feedback */
.feedback {
    margin-top: 20px;
    padding: 15px;
    border-radius: var(--border-radius);
    border-left: 4px solid;
    font-weight: 500;
}

.feedback.success {
    background-color: #f0fdf4;
    border-color: var(--success-color);
    color: #166534;
}

.feedback.error {
    background-color: #fef2f2;
    border-color: var(--error-color);
    color: #991b1b;
}

.feedback.warning {
    background-color: #fffbeb;
    border-color: var(--warning-color);
    color: #92400e;
}

/* Footer */
.footer {
    text-align: center;
    margin-top: 40px;
    padding: 20px;
    color: var(--text-light);
    font-size: 0.9rem;
}

/* Responsividade */
@media (max-width: 768px) {
    .container {
        padding: 15px;
    }
    
    .header {
        padding: 30px 15px;
    }
    
    .header h1 {
        font-size: 2rem;
    }
    
    .subtitle {
        font-size: 1rem;
    }
    
    .links-grid {
        grid-template-columns: 1fr;
        gap: 15px;
    }
    
    .link-card {
        padding: 20px;
    }
    
    .subscription {
        padding: 20px;
    }
}

@media (max-width: 480px) {
    .header h1 {
        font-size: 1.8rem;
    }
    
    .form-group input,
    .submit-btn {
        font-size: 16px; /* Evita zoom no iOS */
    }
}

/* Acessibilidade */
@media (prefers-reduced-motion: reduce) {
    * {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
    }
}

/* Modo escuro */
@media (prefers-color-scheme: dark) {
    :root {
        --text-color: #f9fafb;
        --text-light: #d1d5db;
        --bg-color: #1f2937;
        --bg-light: #111827;
        --border-color: #374151;
    }
    
    .link-card a {
        background-color: transparent;
    }
    
    .form-group input {
        background-color: var(--bg-color);
        color: var(--text-color);
    }
}

/* Estados de carregamento */
.loading-spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid transparent;
    border-top: 2px solid currentColor;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

/* Utilitários */
.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}`;
}

// Função para retornar o conteúdo do script.js
function getScriptJs() {
  return `// DOM Elements
const subscriptionForm = document.getElementById('subscriptionForm');
const emailInput = document.getElementById('email');
const submitBtn = document.getElementById('submitBtn');
const feedback = document.getElementById('feedback');
const feedbackMessage = document.getElementById('feedbackMessage');

// Form validation and submission
class SubscriptionManager {
    constructor() {
        this.init();
    }

    init() {
        this.bindEvents();
        this.setupValidation();
    }

    bindEvents() {
        subscriptionForm.addEventListener('submit', this.handleSubmit.bind(this));
        emailInput.addEventListener('input', this.handleEmailInput.bind(this));
        emailInput.addEventListener('blur', this.validateEmail.bind(this));
    }

    setupValidation() {
        // Real-time validation feedback
        emailInput.addEventListener('input', () => {
            this.clearFeedback();
        });
    }

    handleEmailInput(event) {
        const email = event.target.value.trim();
        
        // Clear previous validation states
        emailInput.classList.remove('valid', 'invalid');
        
        if (email.length > 0) {
            if (this.isValidEmail(email)) {
                emailInput.classList.add('valid');
            } else {
                emailInput.classList.add('invalid');
            }
        }
    }

    validateEmail() {
        const email = emailInput.value.trim();
        
        if (email.length === 0) {
            return false;
        }

        if (!this.isValidEmail(email)) {
            this.showFeedback('Por favor, insira um e-mail válido.', 'error');
            return false;
        }

        return true;
    }

    isValidEmail(email) {
        const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
        return emailRegex.test(email);
    }

    normalizeEmail(email) {
        return email.toLowerCase().trim();
    }

    async handleSubmit(event) {
        event.preventDefault();
        
        const email = this.normalizeEmail(emailInput.value);
        
        // Validate email
        if (!this.isValidEmail(email)) {
            this.showFeedback('Por favor, insira um e-mail válido.', 'error');
            emailInput.focus();
            return;
        }

        // Show loading state
        this.setLoadingState(true);
        this.clearFeedback();

        try {
            const response = await this.submitSubscription(email);
            
            if (response.ok) {
                const data = await response.json();
                this.showFeedback(
                    data.message || 'Inscrição realizada com sucesso! Verifique seu e-mail para confirmação.',
                    'success'
                );
                this.resetForm();
            } else {
                const errorData = await response.json();
                this.handleSubmissionError(errorData);
            }
        } catch (error) {
            console.error('Erro ao processar inscrição:', error);
            this.showFeedback(
                'Erro ao processar sua inscrição. Tente novamente em alguns minutos.',
                'error'
            );
        } finally {
            this.setLoadingState(false);
        }
    }

    async submitSubscription(email) {
        return await fetch('/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email })
        });
    }

    handleSubmissionError(response) {
        if (response.error === 'E-mail inválido') {
            this.showFeedback('E-mail inválido. Verifique o formato.', 'error');
            emailInput.focus();
        } else if (response.message && response.message.includes('já está inscrito')) {
            this.showFeedback('Este e-mail já está inscrito para receber notificações.', 'warning');
        } else {
            this.showFeedback('Erro ao processar inscrição. Tente novamente.', 'error');
        }
    }

    setLoadingState(loading) {
        if (loading) {
            submitBtn.disabled = true;
            submitBtn.classList.add('loading');
        } else {
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
        }
    }

    showFeedback(message, type) {
        feedbackMessage.textContent = message;
        feedback.className = \`feedback \${type}\`;
        feedback.style.display = 'block';
        
        // Scroll to feedback if needed
        feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        // Auto-hide success messages after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                this.clearFeedback();
            }, 5000);
        }
    }

    clearFeedback() {
        feedback.style.display = 'none';
        feedback.className = 'feedback';
        feedbackMessage.textContent = '';
    }

    resetForm() {
        subscriptionForm.reset();
        emailInput.classList.remove('valid', 'invalid');
        emailInput.blur();
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    // Initialize main functionality
    new SubscriptionManager();
    
    console.log('Monitor e-SUS APS inicializado com sucesso');
});

// Error handling for uncaught errors
window.addEventListener('error', (event) => {
    console.error('Erro não capturado:', event.error);
    
    // Show user-friendly error message
    const feedback = document.getElementById('feedback');
    const feedbackMessage = document.getElementById('feedbackMessage');
    
    if (feedback && feedbackMessage) {
        feedbackMessage.textContent = 'Ocorreu um erro inesperado. Recarregue a página e tente novamente.';
        feedback.className = 'feedback error';
        feedback.style.display = 'block';
    }
});

// Handle network errors
window.addEventListener('online', () => {
    console.log('Conexão restaurada');
});

window.addEventListener('offline', () => {
    console.log('Conexão perdida');
    
    const feedback = document.getElementById('feedback');
    const feedbackMessage = document.getElementById('feedbackMessage');
    
    if (feedback && feedbackMessage) {
        feedbackMessage.textContent = 'Sem conexão com a internet. Verifique sua conexão e tente novamente.';
        feedback.className = 'feedback warning';
        feedback.style.display = 'block';
    }
});`;
}