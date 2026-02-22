require('dotenv').config();
const { getAvailableModels } = require('./services/ai-provider');
const gm = getAvailableModels().filter(m => m.provider === 'google');
console.log('=== GOOGLE MODELS: ' + gm.length + ' ===');
gm.forEach(m => console.log(m.available ? 'YES' : 'NO ', m.id, '-', m.name, m.free ? '(FREE)' : ''));
