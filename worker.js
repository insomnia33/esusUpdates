// Monitor de Atualizações do e-SUS APS - Cloudflare Worker
// Implementa scrapers, armazenamento KV e sistema de notificações

// Constantes para chaves do KV
const KV_KEYS = {
  EMAILS: 'subscriber_emails',
  LAST_BLOG_POST: 'last_blog_post',
  LAST_LEDI_VERSION: 'last_ledi_version',
  SYSTEM_STATUS: 'system_status'
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
    
    try {
      console.log(`${request.method} ${url.pathname}`);
      
      // Roteamento principal
      if (request.method === 'POST' && url.pathname === '/subscribe') {
        return await handleSubscription(request, env);
      }
      
      if (request.method === 'GET' && url.pathname === '/health') {
        return await handleHealthCheck(env);
      }
      
      // Servir frontend estático
      return await serveStaticFiles(url.pathname);
      
    } catch (error) {
      console.error('Erro crítico no worker:', error);
      
      return new Response(
        JSON.stringify({ 
          error: 'Erro interno do servidor',
          timestamp: new Date().toISOString()
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
    console.log('Iniciando verificação agendada de atualizações');
    
    try {
      const result = await checkForUpdates(env);
      console.log('Verificação concluída:', result);
      
    } catch (error) {
      console.error('Erro na verificação agendada:', error);
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
      await sendConfirmationEmail(normalizedEmail, latestUpdates);
      console.log(`E-mail de confirmação enviado para: ${normalizedEmail}`);
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
    const subscriberCount = await getSubscriberCount(env);
    const systemStatus = await getSystemStatus(env);
    
    return new Response(
      JSON.stringify({ 
        status: 'ok',
        subscribers: subscriberCount,
        lastCheck: systemStatus.lastCheck,
        timestamp: new Date().toISOString()
      }), 
      { 
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        }
      }
    );
  } catch (error) {
    console.error('Erro no health check:', error);
    
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
    // Servir arquivos estáticos
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

// Scraper para o blog do e-SUS APS
async function getLatestBlogPost() {
  try {
    console.log('Fazendo scraping do blog e-SUS');
    
    const response = await fetch(SOURCES.BLOG, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; e-SUS Monitor/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    let latestPost = {
      title: null,
      link: null,
      extractedAt: new Date().toISOString()
    };
    
    // Usar HTMLRewriter para extrair o primeiro post da sidebar
    const rewriter = new HTMLRewriter()
      .on('div.sidebarItemList_Yudw a:first-of-type', {
        element(element) {
          const title = element.getAttribute('title') || '';
          const href = element.getAttribute('href') || '';
          
          if (title && href) {
            latestPost.title = title.trim();
            latestPost.link = href.startsWith('http') ? href : `https://sisaps.saude.gov.br${href}`;
          }
        }
      });
    
    await rewriter.transform(response);
    
    // Validar dados extraídos
    if (!latestPost.title || !latestPost.link) {
      throw new Error('Não foi possível extrair dados do blog');
    }
    
    console.log(`Blog scraping bem-sucedido: "${latestPost.title}"`);
    return latestPost;
    
  } catch (error) {
    console.error('Erro no scraping do blog:', error);
    throw error;
  }
}

// Scraper para a API LEDI
async function getLatestLediVersion() {
  try {
    console.log('Fazendo scraping da LEDI');
    
    const response = await fetch(SOURCES.LEDI, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; e-SUS Monitor/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    let latestVersion = {
      version: null,
      extractedAt: new Date().toISOString()
    };
    
    let isFirstRow = true;
    
    // Usar HTMLRewriter para extrair a primeira versão da tabela
    const rewriter = new HTMLRewriter()
      .on('table tbody tr td:first-child', {
        text(text) {
          if (isFirstRow && text.text && text.text.trim()) {
            latestVersion.version = text.text.trim();
            isFirstRow = false;
          }
        }
      });
    
    await rewriter.transform(response);
    
    // Validar dados extraídos
    if (!latestVersion.version) {
      throw new Error('Não foi possível extrair versão da LEDI');
    }
    
    // Buscar alterações da versão
    try {
      latestVersion.changes = await getLediChanges();
    } catch (changesError) {
      console.warn('Erro ao buscar alterações da LEDI:', changesError.message);
      latestVersion.changes = 'Alterações não disponíveis no momento';
    }
    
    console.log(`LEDI scraping bem-sucedido: versão "${latestVersion.version}"`);
    return latestVersion;
    
  } catch (error) {
    console.error('Erro no scraping da LEDI:', error);
    throw error;
  }
}

// Buscar alterações da LEDI
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
}

// Validar formato de e-mail
function isValidEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

// Normalizar e-mail (lowercase e trim)
function normalizeEmail(email) {
  return email.toLowerCase().trim();
}

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

// Enviar e-mail usando MailChannels API
async function sendEmail(to, subject, htmlContent) {
  try {
    const payload = {
      personalizations: [
        {
          to: [{ email: to }]
        }
      ],
      from: {
        email: 'noreply@esus-monitor.workers.dev',
        name: 'Monitor e-SUS APS'
      },
      subject: subject,
      content: [
        {
          type: 'text/html',
          value: htmlContent
        }
      ]
    };

    const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
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

// Enviar e-mail de confirmação
async function sendConfirmationEmail(email, latestUpdates) {
  const blogUpdate = latestUpdates.blog;
  const lediUpdate = latestUpdates.ledi;

  const content = `
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
        ${lediUpdate.changes ? `<p><strong>Principais alterações:</strong></p><p style="font-size: 14px; color: #666;">${lediUpdate.changes.substring(0, 300)}${lediUpdate.changes.length > 300 ? '...' : ''}</p>` : ''}
    </div>

    <p>🔔 <strong>Próximos passos:</strong> Você receberá um e-mail sempre que detectarmos novas atualizações em qualquer uma dessas fontes.</p>
  `;

  const htmlContent = getEmailTemplate('Confirmação de Inscrição - Monitor e-SUS APS', content);
  
  return await sendEmail(email, '✅ Confirmação de Inscrição - Monitor e-SUS APS', htmlContent);
}

// Enviar notificações para todos os usuários
async function sendNotificationEmails(env, notifications) {
  try {
    const emails = await getStoredEmails(env);
    let emailsSent = 0;
    
    for (const email of emails) {
      for (const notification of notifications) {
        let subject, content;
        
        if (notification.type === 'blog') {
          subject = `📝 Nova postagem no Blog e-SUS APS: ${notification.data.title}`;
          content = `
            <h2>📝 Nova postagem no Blog e-SUS APS</h2>
            <div class="update-box">
              <div class="update-title">${notification.data.title}</div>
              <p><a href="${notification.data.link}" class="link">Ler postagem completa →</a></p>
            </div>
            <p>Esta postagem foi detectada em ${new Date(notification.data.extractedAt).toLocaleString('pt-BR')}.</p>
          `;
        } else if (notification.type === 'ledi') {
          subject = `🔧 Nova versão da API LEDI: ${notification.data.version}`;
          content = `
            <h2>🔧 Nova versão da API LEDI</h2>
            <div class="update-box">
              <div class="update-title">Versão ${notification.data.version}</div>
              ${notification.data.changes ? `<p><strong>Principais alterações:</strong></p><p style="font-size: 14px; color: #666;">${notification.data.changes}</p>` : ''}
              <p><a href="${SOURCES.LEDI}" class="link">Ver documentação completa →</a></p>
            </div>
            <p>Esta versão foi detectada em ${new Date(notification.data.extractedAt).toLocaleString('pt-BR')}.</p>
          `;
        }
        
        const htmlContent = getEmailTemplate(subject, content);
        
        try {
          const sent = await sendEmail(email, subject, htmlContent);
          if (sent) {
            emailsSent++;
          }
        } catch (error) {
          console.error(`Erro ao enviar e-mail para ${email}:`, error);
        }
      }
    }
    
    return emailsSent;
    
  } catch (error) {
    console.error('Erro ao enviar notificações:', error);
    return 0;
  }
}

// Arquivos estáticos do frontend
function getIndexHtml() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Monitor e-SUS APS</title>
    <link rel="stylesheet" href="/styles.css">
</head>
<body>
    <div class="container">
        <header class="header">
            <h1>🏥 Monitor e-SUS APS</h1>
            <p>Receba notificações automáticas sobre atualizações do e-SUS Atenção Primária à Saúde</p>
        </header>

        <main class="main">
            <section class="monitored-sources">
                <h2>📋 O que monitoramos</h2>
                <div class="sources-grid">
                    <div class="source-card">
                        <h3>📝 Blog e-SUS APS</h3>
                        <p>Novas postagens e notícias oficiais</p>
                        <a href="https://sisaps.saude.gov.br/sistemas/esusaps/blog/" target="_blank" class="source-link">
                            Visitar Blog →
                        </a>
                    </div>
                    <div class="source-card">
                        <h3>🔧 API LEDI</h3>
                        <p>Novas versões e documentação técnica</p>
                        <a href="https://integracao.esusab.ufsc.br/ledi/index.html" target="_blank" class="source-link">
                            Visitar Documentação →
                        </a>
                    </div>
                </div>
            </section>

            <section class="subscription">
                <h2>📧 Inscrever-se para Notificações</h2>
                <p>Digite seu e-mail para receber notificações automáticas sempre que houver atualizações:</p>
                
                <form id="subscriptionForm" class="subscription-form">
                    <div class="form-group">
                        <input 
                            type="email" 
                            id="email" 
                            name="email" 
                            placeholder="seu@email.com" 
                            required
                            class="email-input"
                        >
                        <button type="submit" class="subscribe-button">
                            Inscrever-se
                        </button>
                    </div>
                </form>

                <div id="message" class="message" style="display: none;"></div>
            </section>
        </main>

        <footer class="footer">
            <p>Serviço automatizado de monitoramento • Desenvolvido com Cloudflare Workers</p>
        </footer>
    </div>

    <script src="/script.js"></script>
</body>
</html>`;
}

function getStylesCss() {
  return `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.6;
    color: #1f2937;
    background-color: #f9fafb;
}

.container {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
}

.header {
    text-align: center;
    margin-bottom: 40px;
    padding: 40px 20px;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: white;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(37, 99, 235, 0.2);
}

.header h1 {
    font-size: 2.5rem;
    margin-bottom: 10px;
    font-weight: 700;
}

.header p {
    font-size: 1.1rem;
    opacity: 0.9;
}

.main {
    display: flex;
    flex-direction: column;
    gap: 40px;
}

.monitored-sources h2,
.subscription h2 {
    font-size: 1.5rem;
    margin-bottom: 20px;
    color: #1f2937;
}

.sources-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 20px;
    margin-bottom: 20px;
}

.source-card {
    background: white;
    padding: 24px;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    border: 1px solid #e5e7eb;
}

.source-card h3 {
    font-size: 1.2rem;
    margin-bottom: 8px;
    color: #2563eb;
}

.source-card p {
    color: #6b7280;
    margin-bottom: 16px;
}

.source-link {
    color: #2563eb;
    text-decoration: none;
    font-weight: 500;
}

.source-link:hover {
    text-decoration: underline;
}

.subscription {
    background: white;
    padding: 32px;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    border: 1px solid #e5e7eb;
}

.subscription p {
    color: #6b7280;
    margin-bottom: 24px;
}

.subscription-form {
    margin-bottom: 20px;
}

.form-group {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
}

.email-input {
    flex: 1;
    min-width: 250px;
    padding: 12px 16px;
    border: 2px solid #e5e7eb;
    border-radius: 6px;
    font-size: 16px;
    transition: border-color 0.2s;
}

.email-input:focus {
    outline: none;
    border-color: #2563eb;
}

.subscribe-button {
    padding: 12px 24px;
    background-color: #2563eb;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s;
}

.subscribe-button:hover {
    background-color: #1d4ed8;
}

.subscribe-button:disabled {
    background-color: #9ca3af;
    cursor: not-allowed;
}

.message {
    padding: 12px 16px;
    border-radius: 6px;
    font-weight: 500;
}

.message.success {
    background-color: #d1fae5;
    color: #065f46;
    border: 1px solid #a7f3d0;
}

.message.error {
    background-color: #fee2e2;
    color: #991b1b;
    border: 1px solid #fca5a5;
}

.footer {
    text-align: center;
    margin-top: 40px;
    padding: 20px;
    color: #6b7280;
    font-size: 0.9rem;
}

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
    
    .sources-grid {
        grid-template-columns: 1fr;
    }
    
    .form-group {
        flex-direction: column;
    }
    
    .email-input {
        min-width: auto;
    }
}`;
}

function getScriptJs() {
  return `document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('subscriptionForm');
    const emailInput = document.getElementById('email');
    const submitButton = form.querySelector('button[type="submit"]');
    const messageDiv = document.getElementById('message');

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const email = emailInput.value.trim();
        
        if (!email) {
            showMessage('Por favor, digite um e-mail válido.', 'error');
            return;
        }

        // Validação básica de e-mail
        const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
        if (!emailRegex.test(email)) {
            showMessage('Por favor, digite um e-mail válido.', 'error');
            return;
        }

        // Desabilitar botão durante o envio
        submitButton.disabled = true;
        submitButton.textContent = 'Inscrevendo...';

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
                showMessage(data.message || 'Inscrição realizada com sucesso! Verifique seu e-mail.', 'success');
                emailInput.value = '';
            } else {
                showMessage(data.error || 'Erro ao processar inscrição. Tente novamente.', 'error');
            }

        } catch (error) {
            console.error('Erro ao enviar inscrição:', error);
            showMessage('Erro de conexão. Tente novamente.', 'error');
        } finally {
            // Reabilitar botão
            submitButton.disabled = false;
            submitButton.textContent = 'Inscrever-se';
        }
    });

    function showMessage(text, type) {
        messageDiv.textContent = text;
        messageDiv.className = \`message \${type}\`;
        messageDiv.style.display = 'block';
        
        // Esconder mensagem após 5 segundos
        setTimeout(() => {
            messageDiv.style.display = 'none';
        }, 5000);
    }
});`;
}