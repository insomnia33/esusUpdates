// Script de teste completo para o Monitor e-SUS APS
// Execute com: node test-system.js

const TEST_CONFIG = {
  // URL base do worker (ajuste conforme necessário)
  baseUrl: 'http://localhost:8787', // Para desenvolvimento local
  // baseUrl: 'https://esus-monitor.your-subdomain.workers.dev', // Para produção
  
  // E-mail de teste (substitua por um e-mail real para testes)
  testEmail: 'test@example.com',
  
  // Configurações de timeout
  timeout: 30000, // 30 segundos
  
  // Configurações de retry
  maxRetries: 3,
  retryDelay: 2000 // 2 segundos
};

class SystemTester {
  constructor(config) {
    this.config = config;
    this.results = {
      timestamp: new Date().toISOString(),
      tests: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0
      }
    };
  }

  // Função auxiliar para fazer requisições HTTP
  async makeRequest(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  // Função para executar um teste individual
  async runTest(testName, testFunction) {
    console.log(`\n🧪 Executando: ${testName}`);
    
    const testResult = {
      name: testName,
      status: 'running',
      startTime: Date.now(),
      endTime: null,
      duration: 0,
      error: null,
      details: {}
    };

    this.results.tests.push(testResult);
    this.results.summary.total++;

    try {
      const details = await testFunction();
      
      testResult.status = 'passed';
      testResult.details = details || {};
      this.results.summary.passed++;
      
      console.log(`✅ ${testName} - PASSOU`);
      
    } catch (error) {
      testResult.status = 'failed';
      testResult.error = {
        message: error.message,
        stack: error.stack
      };
      this.results.summary.failed++;
      
      console.log(`❌ ${testName} - FALHOU: ${error.message}`);
    } finally {
      testResult.endTime = Date.now();
      testResult.duration = testResult.endTime - testResult.startTime;
    }

    return testResult;
  }

  // Teste 1: Verificar se o frontend está acessível
  async testFrontendAccess() {
    const response = await this.makeRequest(this.config.baseUrl);
    
    if (!response.ok) {
      throw new Error(`Frontend não acessível: ${response.status}`);
    }

    const html = await response.text();
    
    if (!html.includes('Monitor de Atualizações e-SUS APS')) {
      throw new Error('Conteúdo do frontend não encontrado');
    }

    return {
      status: response.status,
      contentLength: html.length,
      hasTitle: html.includes('<title>'),
      hasForm: html.includes('subscriptionForm')
    };
  }

  // Teste 2: Verificar arquivos estáticos (CSS e JS)
  async testStaticFiles() {
    const files = [
      { path: '/styles.css', contentType: 'text/css', contains: 'container' },
      { path: '/script.js', contentType: 'application/javascript', contains: 'SubscriptionManager' }
    ];

    const results = {};

    for (const file of files) {
      const response = await this.makeRequest(`${this.config.baseUrl}${file.path}`);
      
      if (!response.ok) {
        throw new Error(`Arquivo ${file.path} não acessível: ${response.status}`);
      }

      const content = await response.text();
      const contentType = response.headers.get('content-type');

      if (!contentType.includes(file.contentType)) {
        throw new Error(`Content-Type incorreto para ${file.path}: ${contentType}`);
      }

      if (!content.includes(file.contains)) {
        throw new Error(`Conteúdo esperado não encontrado em ${file.path}`);
      }

      results[file.path] = {
        status: response.status,
        contentType,
        contentLength: content.length
      };
    }

    return results;
  }

  // Teste 3: Verificar endpoint de saúde
  async testHealthEndpoint() {
    const response = await this.makeRequest(`${this.config.baseUrl}/health`);
    
    if (!response.ok && response.status !== 503) {
      throw new Error(`Health endpoint falhou: ${response.status}`);
    }

    const health = await response.json();
    
    if (!health.lastCheck && !health.status) {
      throw new Error('Resposta de saúde inválida');
    }

    return {
      httpStatus: response.status,
      systemStatus: health.status,
      lastCheck: health.lastCheck,
      hasMetrics: !!health.metrics,
      subscriberCount: health.metrics?.subscriberCount || 0
    };
  }

  // Teste 4: Testar inscrição de e-mail
  async testEmailSubscription() {
    const testEmail = `test-${Date.now()}@example.com`;
    
    const response = await this.makeRequest(`${this.config.baseUrl}/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: testEmail })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Inscrição falhou: ${response.status} - ${errorData.error || errorData.message}`);
    }

    const result = await response.json();
    
    if (!result.message) {
      throw new Error('Resposta de inscrição inválida');
    }

    return {
      status: response.status,
      message: result.message,
      testEmail
    };
  }

  // Teste 5: Testar validação de e-mail inválido
  async testInvalidEmailValidation() {
    const invalidEmails = ['invalid', 'test@', '@domain.com', 'test@domain'];
    const results = {};

    for (const email of invalidEmails) {
      const response = await this.makeRequest(`${this.config.baseUrl}/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email })
      });

      if (response.ok) {
        throw new Error(`E-mail inválido aceito: ${email}`);
      }

      const errorData = await response.json();
      results[email] = {
        status: response.status,
        error: errorData.error
      };
    }

    return results;
  }

  // Teste 6: Verificar responsividade (simulação)
  async testResponsiveness() {
    const userAgents = [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)', // Mobile
      'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X)', // Tablet
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' // Desktop
    ];

    const results = {};

    for (const userAgent of userAgents) {
      const response = await this.makeRequest(this.config.baseUrl, {
        headers: {
          'User-Agent': userAgent
        }
      });

      if (!response.ok) {
        throw new Error(`Falha com User-Agent: ${userAgent}`);
      }

      const html = await response.text();
      
      results[userAgent.includes('iPhone') ? 'mobile' : userAgent.includes('iPad') ? 'tablet' : 'desktop'] = {
        status: response.status,
        hasViewport: html.includes('viewport'),
        hasResponsiveCSS: html.includes('max-width')
      };
    }

    return results;
  }

  // Teste 7: Verificar performance básica
  async testBasicPerformance() {
    const tests = [
      { name: 'Frontend', url: this.config.baseUrl },
      { name: 'CSS', url: `${this.config.baseUrl}/styles.css` },
      { name: 'JS', url: `${this.config.baseUrl}/script.js` },
      { name: 'Health', url: `${this.config.baseUrl}/health` }
    ];

    const results = {};

    for (const test of tests) {
      const startTime = Date.now();
      const response = await this.makeRequest(test.url);
      const endTime = Date.now();
      
      const duration = endTime - startTime;
      
      if (!response.ok) {
        throw new Error(`${test.name} falhou: ${response.status}`);
      }

      // Considerar lento se demorar mais de 5 segundos
      if (duration > 5000) {
        console.warn(`⚠️ ${test.name} está lento: ${duration}ms`);
      }

      results[test.name] = {
        duration,
        status: response.status,
        size: parseInt(response.headers.get('content-length') || '0')
      };
    }

    return results;
  }

  // Executar todos os testes
  async runAllTests() {
    console.log('🚀 Iniciando bateria de testes completa do Monitor e-SUS APS');
    console.log(`📍 URL base: ${this.config.baseUrl}`);
    console.log(`⏱️ Timeout: ${this.config.timeout}ms`);
    
    const startTime = Date.now();

    // Lista de testes a executar
    const tests = [
      { name: 'Frontend Access', fn: () => this.testFrontendAccess() },
      { name: 'Static Files', fn: () => this.testStaticFiles() },
      { name: 'Health Endpoint', fn: () => this.testHealthEndpoint() },
      { name: 'Email Subscription', fn: () => this.testEmailSubscription() },
      { name: 'Invalid Email Validation', fn: () => this.testInvalidEmailValidation() },
      { name: 'Responsiveness', fn: () => this.testResponsiveness() },
      { name: 'Basic Performance', fn: () => this.testBasicPerformance() }
    ];

    // Executar testes sequencialmente
    for (const test of tests) {
      await this.runTest(test.name, test.fn);
    }

    const endTime = Date.now();
    const totalDuration = endTime - startTime;

    // Gerar relatório final
    this.generateReport(totalDuration);
    
    return this.results;
  }

  // Gerar relatório de testes
  generateReport(totalDuration) {
    console.log('\n' + '='.repeat(60));
    console.log('📊 RELATÓRIO FINAL DE TESTES');
    console.log('='.repeat(60));
    
    console.log(`⏱️ Duração total: ${totalDuration}ms`);
    console.log(`📈 Total de testes: ${this.results.summary.total}`);
    console.log(`✅ Passou: ${this.results.summary.passed}`);
    console.log(`❌ Falhou: ${this.results.summary.failed}`);
    console.log(`⏭️ Pulou: ${this.results.summary.skipped}`);
    
    const successRate = this.results.summary.total > 0 
      ? Math.round((this.results.summary.passed / this.results.summary.total) * 100)
      : 0;
    
    console.log(`🎯 Taxa de sucesso: ${successRate}%`);

    if (this.results.summary.failed > 0) {
      console.log('\n❌ TESTES QUE FALHARAM:');
      this.results.tests
        .filter(test => test.status === 'failed')
        .forEach(test => {
          console.log(`  • ${test.name}: ${test.error.message}`);
        });
    }

    console.log('\n📋 DETALHES DOS TESTES:');
    this.results.tests.forEach(test => {
      const status = test.status === 'passed' ? '✅' : test.status === 'failed' ? '❌' : '⏭️';
      console.log(`  ${status} ${test.name} (${test.duration}ms)`);
    });

    // Salvar relatório em arquivo
    this.saveReport();
  }

  // Salvar relatório em arquivo JSON
  saveReport() {
    const fs = require('fs');
    const filename = `test-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    
    try {
      fs.writeFileSync(filename, JSON.stringify(this.results, null, 2));
      console.log(`\n💾 Relatório salvo em: ${filename}`);
    } catch (error) {
      console.warn(`⚠️ Não foi possível salvar o relatório: ${error.message}`);
    }
  }
}

// Função principal
async function main() {
  try {
    const tester = new SystemTester(TEST_CONFIG);
    await tester.runAllTests();
    
    // Código de saída baseado nos resultados
    process.exit(tester.results.summary.failed > 0 ? 1 : 0);
    
  } catch (error) {
    console.error('💥 Erro fatal durante os testes:', error);
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  main();
}

module.exports = { SystemTester, TEST_CONFIG };