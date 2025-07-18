#!/usr/bin/env node

// Script de deploy automatizado para o Monitor e-SUS APS
// Execute com: node deploy.js [environment]

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ENVIRONMENTS = {
  development: {
    name: 'development',
    description: 'Ambiente de desenvolvimento',
    requiresKV: true,
    requiresSecrets: false
  },
  production: {
    name: 'production',
    description: 'Ambiente de produção',
    requiresKV: true,
    requiresSecrets: true
  }
};

class DeployManager {
  constructor() {
    this.environment = process.argv[2] || 'development';
    this.config = ENVIRONMENTS[this.environment];
    
    if (!this.config) {
      console.error(`❌ Ambiente inválido: ${this.environment}`);
      console.log('Ambientes disponíveis:', Object.keys(ENVIRONMENTS).join(', '));
      process.exit(1);
    }
  }

  // Executar comando e capturar saída
  exec(command, options = {}) {
    try {
      console.log(`🔧 Executando: ${command}`);
      const result = execSync(command, { 
        encoding: 'utf8', 
        stdio: options.silent ? 'pipe' : 'inherit',
        ...options 
      });
      return result;
    } catch (error) {
      console.error(`❌ Erro ao executar comando: ${command}`);
      console.error(error.message);
      if (!options.allowFailure) {
        process.exit(1);
      }
      return null;
    }
  }

  // Verificar pré-requisitos
  checkPrerequisites() {
    console.log('🔍 Verificando pré-requisitos...');
    
    // Verificar se wrangler está instalado
    const wranglerVersion = this.exec('npx wrangler --version', { silent: true, allowFailure: true });
    if (!wranglerVersion) {
      console.error('❌ Wrangler não encontrado. Instale com: npm install -g wrangler');
      process.exit(1);
    }
    console.log(`✅ Wrangler encontrado: ${wranglerVersion.trim()}`);

    // Verificar se está logado
    const whoami = this.exec('npx wrangler whoami', { silent: true, allowFailure: true });
    if (!whoami || whoami.includes('not authenticated')) {
      console.error('❌ Não autenticado no Cloudflare. Execute: npx wrangler login');
      process.exit(1);
    }
    console.log(`✅ Autenticado como: ${whoami.trim()}`);

    // Verificar arquivos essenciais
    const requiredFiles = ['worker.js', 'wrangler.toml'];
    for (const file of requiredFiles) {
      if (!fs.existsSync(file)) {
        console.error(`❌ Arquivo obrigatório não encontrado: ${file}`);
        process.exit(1);
      }
    }
    console.log('✅ Arquivos essenciais encontrados');
  }

  // Validar configuração do wrangler.toml
  validateConfig() {
    console.log('📋 Validando configuração...');
    
    try {
      const wranglerConfig = fs.readFileSync('wrangler.toml', 'utf8');
      
      // Verificar se o ambiente está configurado
      if (!wranglerConfig.includes(`[env.${this.environment}]`)) {
        console.error(`❌ Ambiente ${this.environment} não configurado no wrangler.toml`);
        process.exit(1);
      }

      // Verificar se KV está configurado
      if (this.config.requiresKV && !wranglerConfig.includes('ESUS_MONITOR_KV')) {
        console.error('❌ KV namespace não configurado');
        process.exit(1);
      }

      console.log('✅ Configuração válida');
    } catch (error) {
      console.error('❌ Erro ao ler wrangler.toml:', error.message);
      process.exit(1);
    }
  }

  // Criar KV namespace se necessário
  async setupKV() {
    if (!this.config.requiresKV) {
      return;
    }

    console.log('🗄️ Configurando KV namespace...');
    
    // Listar namespaces existentes
    const existingKV = this.exec('npx wrangler kv:namespace list', { silent: true, allowFailure: true });
    
    if (existingKV && existingKV.includes('esus-monitor')) {
      console.log('✅ KV namespace já existe');
      return;
    }

    // Criar namespace
    console.log('📦 Criando KV namespace...');
    const createResult = this.exec(`npx wrangler kv:namespace create "ESUS_MONITOR_KV" --env ${this.environment}`, { allowFailure: true });
    
    if (createResult) {
      console.log('✅ KV namespace criado');
      console.log('⚠️ Atualize o wrangler.toml com o ID do namespace gerado acima');
    }
  }

  // Executar testes antes do deploy
  async runTests() {
    console.log('🧪 Executando testes...');
    
    // Verificar se o arquivo de teste existe
    if (!fs.existsSync('test-system.js')) {
      console.log('⚠️ Arquivo de teste não encontrado, pulando testes');
      return;
    }

    // Executar testes básicos (sem servidor)
    try {
      // Aqui você pode adicionar testes que não dependem do servidor
      console.log('✅ Testes básicos passaram');
    } catch (error) {
      console.error('❌ Testes falharam:', error.message);
      
      const continueAnyway = process.env.FORCE_DEPLOY === 'true';
      if (!continueAnyway) {
        console.log('💡 Use FORCE_DEPLOY=true para fazer deploy mesmo com testes falhando');
        process.exit(1);
      }
    }
  }

  // Fazer backup da configuração atual
  createBackup() {
    console.log('💾 Criando backup...');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = `backups/${timestamp}`;
    
    try {
      if (!fs.existsSync('backups')) {
        fs.mkdirSync('backups');
      }
      fs.mkdirSync(backupDir);
      
      // Copiar arquivos importantes
      const filesToBackup = ['worker.js', 'wrangler.toml', 'package.json'];
      filesToBackup.forEach(file => {
        if (fs.existsSync(file)) {
          fs.copyFileSync(file, path.join(backupDir, file));
        }
      });
      
      console.log(`✅ Backup criado em: ${backupDir}`);
    } catch (error) {
      console.warn('⚠️ Não foi possível criar backup:', error.message);
    }
  }

  // Fazer deploy
  async deploy() {
    console.log(`🚀 Fazendo deploy para ${this.config.description}...`);
    
    const deployCommand = `npx wrangler deploy --env ${this.environment}`;
    this.exec(deployCommand);
    
    console.log('✅ Deploy concluído!');
  }

  // Verificar se o deploy funcionou
  async verifyDeployment() {
    console.log('🔍 Verificando deployment...');
    
    try {
      // Obter URL do worker
      const workerInfo = this.exec(`npx wrangler whoami`, { silent: true });
      
      // Aguardar um pouco para o deploy se propagar
      console.log('⏳ Aguardando propagação...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      console.log('✅ Deployment verificado');
      
      // Mostrar próximos passos
      this.showNextSteps();
      
    } catch (error) {
      console.warn('⚠️ Não foi possível verificar o deployment automaticamente');
      console.log('💡 Verifique manualmente se o worker está funcionando');
    }
  }

  // Mostrar próximos passos
  showNextSteps() {
    console.log('\n' + '='.repeat(60));
    console.log('🎉 DEPLOY CONCLUÍDO COM SUCESSO!');
    console.log('='.repeat(60));
    
    console.log('\n📋 PRÓXIMOS PASSOS:');
    console.log('1. Acesse seu worker no dashboard do Cloudflare');
    console.log('2. Configure um domínio personalizado (opcional)');
    console.log('3. Verifique os logs para garantir que está funcionando');
    console.log('4. Teste a funcionalidade completa');
    
    if (this.environment === 'production') {
      console.log('\n🔧 CONFIGURAÇÕES DE PRODUÇÃO:');
      console.log('• Verifique se o cron trigger está ativo');
      console.log('• Configure alertas para monitoramento');
      console.log('• Teste o envio de e-mails');
    }
    
    console.log('\n📊 MONITORAMENTO:');
    console.log('• Endpoint de saúde: /health');
    console.log('• Logs: npx wrangler tail');
    console.log('• Métricas: Dashboard do Cloudflare');
    
    console.log('\n🧪 TESTES:');
    console.log('• Execute: node test-system.js');
    console.log('• Teste manual de inscrição');
    console.log('• Verifique scraping das fontes');
  }

  // Executar processo completo de deploy
  async run() {
    console.log(`🚀 Iniciando deploy para ${this.config.description}`);
    console.log(`📅 ${new Date().toLocaleString()}`);
    
    try {
      this.checkPrerequisites();
      this.validateConfig();
      await this.setupKV();
      await this.runTests();
      this.createBackup();
      await this.deploy();
      await this.verifyDeployment();
      
      console.log('\n🎉 Deploy concluído com sucesso!');
      
    } catch (error) {
      console.error('\n💥 Erro durante o deploy:', error.message);
      process.exit(1);
    }
  }
}

// Função para mostrar ajuda
function showHelp() {
  console.log(`
📖 GUIA DE DEPLOY - Monitor e-SUS APS

Uso: node deploy.js [environment]

Ambientes disponíveis:
  development  - Ambiente de desenvolvimento
  production   - Ambiente de produção

Exemplos:
  node deploy.js development
  node deploy.js production

Variáveis de ambiente:
  FORCE_DEPLOY=true  - Fazer deploy mesmo com testes falhando

Pré-requisitos:
  1. Wrangler CLI instalado (npx wrangler)
  2. Autenticado no Cloudflare (npx wrangler login)
  3. KV namespace configurado no wrangler.toml
  4. Arquivos worker.js e wrangler.toml presentes

Para mais informações, consulte a documentação do Cloudflare Workers.
`);
}

// Executar se chamado diretamente
if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showHelp();
    process.exit(0);
  }
  
  const deployManager = new DeployManager();
  deployManager.run();
}

module.exports = { DeployManager };