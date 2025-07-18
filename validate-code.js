// Script de validação de código para o Monitor e-SUS APS
// Testa a lógica do código sem precisar de um servidor rodando

const fs = require('fs');

class CodeValidator {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      tests: [],
      summary: { total: 0, passed: 0, failed: 0 }
    };
  }

  // Função para executar um teste
  runTest(testName, testFunction) {
    console.log(`🧪 Testando: ${testName}`);
    
    const testResult = {
      name: testName,
      status: 'running',
      startTime: Date.now(),
      error: null
    };

    this.results.tests.push(testResult);
    this.results.summary.total++;

    try {
      testFunction();
      testResult.status = 'passed';
      this.results.summary.passed++;
      console.log(`✅ ${testName} - PASSOU`);
    } catch (error) {
      testResult.status = 'failed';
      testResult.error = error.message;
      this.results.summary.failed++;
      console.log(`❌ ${testName} - FALHOU: ${error.message}`);
    }

    testResult.endTime = Date.now();
    testResult.duration = testResult.endTime - testResult.startTime;
    return testResult;
  }

  // Teste 1: Verificar se todos os arquivos essenciais existem
  testRequiredFiles() {
    const requiredFiles = [
      'worker.js',
      'index.html', 
      'script.js',
      'styles.css',
      'wrangler.toml'
    ];

    for (const file of requiredFiles) {
      if (!fs.existsSync(file)) {
        throw new Error(`Arquivo obrigatório não encontrado: ${file}`);
      }
    }

    // Verificar tamanhos mínimos
    const minSizes = {
      'worker.js': 10000,  // Pelo menos 10KB
      'index.html': 1000,  // Pelo menos 1KB
      'script.js': 2000,   // Pelo menos 2KB
      'styles.css': 3000   // Pelo menos 3KB
    };

    for (const [file, minSize] of Object.entries(minSizes)) {
      const stats = fs.statSync(file);
      if (stats.size < minSize) {
        throw new Error(`Arquivo ${file} muito pequeno: ${stats.size} bytes (mínimo: ${minSize})`);
      }
    }
  }

  // Teste 2: Validar sintaxe do worker.js
  testWorkerSyntax() {
    const workerCode = fs.readFileSync('worker.js', 'utf8');
    
    // Verificar estruturas essenciais
    const requiredPatterns = [
      /export default \{/,
      /async fetch\(/,
      /async scheduled\(/,
      /handleSubscription/,
      /getLatestBlogPost/,
      /getLatestLediVersion/,
      /sendNotificationEmails/
    ];

    for (const pattern of requiredPatterns) {
      if (!pattern.test(workerCode)) {
        throw new Error(`Padrão obrigatório não encontrado: ${pattern}`);
      }
    }

    // Verificar se não há erros de sintaxe óbvios
    if (workerCode.includes('undefined') && !workerCode.includes('!== undefined')) {
      console.warn('⚠️ Possível uso de undefined detectado');
    }
  }

  // Teste 3: Validar configuração do wrangler.toml
  testWranglerConfig() {
    const wranglerContent = fs.readFileSync('wrangler.toml', 'utf8');
    
    // Verificar configurações essenciais
    const requiredConfigs = [
      'name = "esus-monitor"',
      'main = "worker.js"',
      'ESUS_MONITOR_KV',
      '[triggers]',
      'crons'
    ];

    for (const config of requiredConfigs) {
      if (!wranglerContent.includes(config)) {
        throw new Error(`Configuração obrigatória não encontrada: ${config}`);
      }
    }

    // Verificar se há ambientes configurados
    if (!wranglerContent.includes('[env.production]')) {
      throw new Error('Ambiente de produção não configurado');
    }
  }

  // Teste 4: Validar HTML
  testHTMLStructure() {
    const htmlContent = fs.readFileSync('index.html', 'utf8');
    
    // Verificar estrutura básica
    const requiredElements = [
      '<!DOCTYPE html>',
      '<html lang="pt-BR">',
      '<meta charset="UTF-8">',
      '<meta name="viewport"',
      'subscriptionForm',
      'Monitor de Atualizações e-SUS APS'
    ];

    for (const element of requiredElements) {
      if (!htmlContent.includes(element)) {
        throw new Error(`Elemento HTML obrigatório não encontrado: ${element}`);
      }
    }

    // Verificar se não há tags não fechadas óbvias
    const openTags = (htmlContent.match(/<[^/][^>]*>/g) || []).length;
    const closeTags = (htmlContent.match(/<\/[^>]*>/g) || []).length;
    
    // Permitir algumas tags auto-fechadas
    if (Math.abs(openTags - closeTags) > 10) {
      console.warn('⚠️ Possível desequilíbrio de tags HTML detectado');
    }
  }

  // Teste 5: Validar CSS
  testCSSStructure() {
    const cssContent = fs.readFileSync('styles.css', 'utf8');
    
    // Verificar seletores essenciais
    const requiredSelectors = [
      '.container',
      '.header',
      '.subscription-form',
      '.feedback',
      '@media'
    ];

    for (const selector of requiredSelectors) {
      if (!cssContent.includes(selector)) {
        throw new Error(`Seletor CSS obrigatório não encontrado: ${selector}`);
      }
    }

    // Verificar variáveis CSS
    if (!cssContent.includes(':root') || !cssContent.includes('--primary-color')) {
      throw new Error('Variáveis CSS não encontradas');
    }
  }

  // Teste 6: Validar JavaScript
  testJavaScriptStructure() {
    const jsContent = fs.readFileSync('script.js', 'utf8');
    
    // Verificar classes e funções essenciais
    const requiredPatterns = [
      /class SubscriptionManager/,
      /handleSubmit/,
      /isValidEmail/,
      /addEventListener/,
      /fetch\(/
    ];

    for (const pattern of requiredPatterns) {
      if (!pattern.test(jsContent)) {
        throw new Error(`Padrão JavaScript obrigatório não encontrado: ${pattern}`);
      }
    }

    // Verificar se não há console.log em produção (apenas warning)
    if (jsContent.includes('console.log')) {
      console.warn('⚠️ console.log encontrado no JavaScript (considere remover para produção)');
    }
  }

  // Teste 7: Validar URLs e constantes
  testURLsAndConstants() {
    const workerCode = fs.readFileSync('worker.js', 'utf8');
    
    // Verificar URLs das fontes
    const requiredURLs = [
      'https://sisaps.saude.gov.br/sistemas/esusaps/blog/',
      'https://integracao.esusab.ufsc.br/ledi/index.html'
    ];

    for (const url of requiredURLs) {
      if (!workerCode.includes(url)) {
        throw new Error(`URL obrigatória não encontrada: ${url}`);
      }
    }

    // Verificar constantes KV
    if (!workerCode.includes('KV_KEYS') || !workerCode.includes('EMAILS')) {
      throw new Error('Constantes KV não encontradas');
    }
  }

  // Teste 8: Verificar tratamento de erros
  testErrorHandling() {
    const workerCode = fs.readFileSync('worker.js', 'utf8');
    
    // Verificar se há try/catch adequados
    const tryCount = (workerCode.match(/try \{/g) || []).length;
    const catchCount = (workerCode.match(/catch \(/g) || []).length;
    
    if (tryCount < 5) {
      throw new Error(`Poucos blocos try/catch encontrados: ${tryCount} (esperado: pelo menos 5)`);
    }
    
    if (tryCount !== catchCount) {
      throw new Error(`Desequilíbrio try/catch: ${tryCount} try, ${catchCount} catch`);
    }

    // Verificar se há logs de erro
    if (!workerCode.includes('console.error')) {
      throw new Error('Logs de erro não encontrados');
    }
  }

  // Executar todos os testes
  runAllTests() {
    console.log('🚀 Iniciando validação de código do Monitor e-SUS APS');
    console.log(`📅 ${new Date().toLocaleString()}`);
    
    const tests = [
      { name: 'Required Files', fn: () => this.testRequiredFiles() },
      { name: 'Worker Syntax', fn: () => this.testWorkerSyntax() },
      { name: 'Wrangler Config', fn: () => this.testWranglerConfig() },
      { name: 'HTML Structure', fn: () => this.testHTMLStructure() },
      { name: 'CSS Structure', fn: () => this.testCSSStructure() },
      { name: 'JavaScript Structure', fn: () => this.testJavaScriptStructure() },
      { name: 'URLs and Constants', fn: () => this.testURLsAndConstants() },
      { name: 'Error Handling', fn: () => this.testErrorHandling() }
    ];

    const startTime = Date.now();

    for (const test of tests) {
      this.runTest(test.name, test.fn);
    }

    const endTime = Date.now();
    const totalDuration = endTime - startTime;

    this.generateReport(totalDuration);
    return this.results;
  }

  // Gerar relatório
  generateReport(totalDuration) {
    console.log('\n' + '='.repeat(60));
    console.log('📊 RELATÓRIO DE VALIDAÇÃO DE CÓDIGO');
    console.log('='.repeat(60));
    
    console.log(`⏱️ Duração total: ${totalDuration}ms`);
    console.log(`📈 Total de testes: ${this.results.summary.total}`);
    console.log(`✅ Passou: ${this.results.summary.passed}`);
    console.log(`❌ Falhou: ${this.results.summary.failed}`);
    
    const successRate = this.results.summary.total > 0 
      ? Math.round((this.results.summary.passed / this.results.summary.total) * 100)
      : 0;
    
    console.log(`🎯 Taxa de sucesso: ${successRate}%`);

    if (this.results.summary.failed > 0) {
      console.log('\n❌ TESTES QUE FALHARAM:');
      this.results.tests
        .filter(test => test.status === 'failed')
        .forEach(test => {
          console.log(`  • ${test.name}: ${test.error}`);
        });
    } else {
      console.log('\n🎉 Todos os testes passaram! O código está pronto para deploy.');
    }

    console.log('\n📋 PRÓXIMOS PASSOS:');
    if (successRate === 100) {
      console.log('1. Execute: node deploy.js development (para testar)');
      console.log('2. Execute: node deploy.js production (para produção)');
      console.log('3. Configure as variáveis de ambiente necessárias');
      console.log('4. Teste a funcionalidade completa após o deploy');
    } else {
      console.log('1. Corrija os erros encontrados');
      console.log('2. Execute novamente: node validate-code.js');
      console.log('3. Após correção, faça o deploy');
    }
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  const validator = new CodeValidator();
  const results = validator.runAllTests();
  
  // Código de saída baseado nos resultados
  process.exit(results.summary.failed > 0 ? 1 : 0);
}

module.exports = { CodeValidator };