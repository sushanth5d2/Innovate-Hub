/**
 * File Analyzer Service
 * Extracts content from uploaded files for AI analysis:
 * - Images: converts to base64 for vision models
 * - PDFs: extracts text content
 * - DOCX: extracts text content  
 * - Text files: reads directly
 */

const fs = require('fs');
const path = require('path');

let pdfParse, mammoth;
try { pdfParse = require('pdf-parse'); } catch(e) { console.log('[FileAnalyzer] pdf-parse not available'); }
try { mammoth = require('mammoth'); } catch(e) { console.log('[FileAnalyzer] mammoth not available'); }

/**
 * Analyze an uploaded file and return structured content for AI processing
 * @param {string} filePath - Path to the uploaded file (relative or absolute)
 * @param {string} mimeType - MIME type of the file
 * @param {string} originalName - Original filename
 * @returns {Object} { type, content, base64?, mimeType, summary }
 */
async function analyzeFile(filePath, mimeType, originalName) {
  const fullPath = resolveFilePath(filePath);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`[FileAnalyzer] File not found: ${fullPath}`);
    return { type: 'unknown', content: `[File: ${originalName}]`, error: 'File not found' };
  }

  const ext = path.extname(originalName || filePath).toLowerCase();

  // Images → base64 for vision models
  if (mimeType?.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) {
    return analyzeImage(fullPath, mimeType || `image/${ext.slice(1)}`);
  }

  // PDFs → extract text
  if (mimeType === 'application/pdf' || ext === '.pdf') {
    return analyzePDF(fullPath, originalName);
  }

  // Word documents → extract text
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === '.docx') {
    return analyzeDOCX(fullPath, originalName);
  }

  // Plain text, code, markdown, csv, json, etc.
  if (isTextFile(mimeType, ext)) {
    return analyzeText(fullPath, originalName, ext);
  }

  // Unknown file type
  return {
    type: 'file',
    content: `[Uploaded file: ${originalName} (${mimeType || 'unknown type'})]`,
    extractedText: null,
    canAnalyze: false
  };
}

/**
 * Process image for vision API
 */
function analyzeImage(fullPath, mimeType) {
  const buffer = fs.readFileSync(fullPath);
  const base64 = buffer.toString('base64');
  
  // Normalize MIME type
  let normalizedMime = mimeType;
  if (normalizedMime === 'image/jpg') normalizedMime = 'image/jpeg';
  if (!normalizedMime.startsWith('image/')) normalizedMime = 'image/png';

  const fileSizeKB = Math.round(buffer.length / 1024);
  
  return {
    type: 'image',
    base64,
    mimeType: normalizedMime,
    dataUri: `data:${normalizedMime};base64,${base64}`,
    fileSizeKB,
    canAnalyze: true,
    requiresVision: true,
    content: '[Image uploaded for analysis]'
  };
}

/**
 * Extract text from PDF files
 */
async function analyzePDF(fullPath, originalName) {
  if (!pdfParse) {
    return {
      type: 'pdf',
      content: `[PDF: ${originalName}] — PDF parsing is not available. Install pdf-parse: npm install pdf-parse`,
      extractedText: null,
      canAnalyze: false
    };
  }

  try {
    const buffer = fs.readFileSync(fullPath);
    const data = await pdfParse(buffer);
    
    let text = data.text || '';
    // Clean up excessive whitespace
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    
    // Truncate very long documents (keep ~15k chars for context window)
    const maxLength = 15000;
    let truncated = false;
    if (text.length > maxLength) {
      text = text.substring(0, maxLength);
      truncated = true;
    }

    return {
      type: 'pdf',
      content: text,
      extractedText: text,
      pageCount: data.numpages,
      truncated,
      originalLength: data.text?.length || 0,
      canAnalyze: true,
      requiresVision: false,
      summary: `PDF document "${originalName}" — ${data.numpages} pages, ${data.text?.length || 0} characters${truncated ? ' (truncated to fit context)' : ''}`
    };
  } catch (err) {
    console.error('[FileAnalyzer] PDF parse error:', err.message);
    return {
      type: 'pdf',
      content: `[PDF: ${originalName}] — Failed to extract text: ${err.message}`,
      extractedText: null,
      canAnalyze: false
    };
  }
}

/**
 * Extract text from DOCX files
 */
async function analyzeDOCX(fullPath, originalName) {
  if (!mammoth) {
    return {
      type: 'docx',
      content: `[Document: ${originalName}] — DOCX parsing not available. Install mammoth: npm install mammoth`,
      extractedText: null,
      canAnalyze: false
    };
  }

  try {
    const result = await mammoth.extractRawText({ path: fullPath });
    let text = result.value || '';
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    const maxLength = 15000;
    let truncated = false;
    if (text.length > maxLength) {
      text = text.substring(0, maxLength);
      truncated = true;
    }

    return {
      type: 'docx',
      content: text,
      extractedText: text,
      truncated,
      originalLength: result.value?.length || 0,
      canAnalyze: true,
      requiresVision: false,
      summary: `Word document "${originalName}" — ${result.value?.length || 0} characters${truncated ? ' (truncated)' : ''}`
    };
  } catch (err) {
    console.error('[FileAnalyzer] DOCX parse error:', err.message);
    return {
      type: 'docx',
      content: `[Document: ${originalName}] — Failed to extract text: ${err.message}`,
      extractedText: null,
      canAnalyze: false
    };
  }
}

/**
 * Read plain text files (code, txt, md, csv, json, etc.)
 */
function analyzeText(fullPath, originalName, ext) {
  try {
    let text = fs.readFileSync(fullPath, 'utf-8');
    
    const maxLength = 15000;
    let truncated = false;
    if (text.length > maxLength) {
      text = text.substring(0, maxLength);
      truncated = true;
    }

    // Determine language for code formatting
    const langMap = {
      '.js': 'javascript', '.ts': 'typescript', '.py': 'python',
      '.java': 'java', '.cpp': 'cpp', '.c': 'c', '.cs': 'csharp',
      '.rb': 'ruby', '.go': 'go', '.rs': 'rust', '.php': 'php',
      '.html': 'html', '.css': 'css', '.sql': 'sql', '.sh': 'bash',
      '.yml': 'yaml', '.yaml': 'yaml', '.xml': 'xml',
      '.json': 'json', '.md': 'markdown', '.txt': 'text', '.csv': 'csv'
    };
    const language = langMap[ext] || 'text';

    return {
      type: 'text',
      content: text,
      extractedText: text,
      language,
      truncated,
      canAnalyze: true,
      requiresVision: false,
      summary: `${language.toUpperCase()} file "${originalName}" — ${text.length} characters${truncated ? ' (truncated)' : ''}`
    };
  } catch (err) {
    return {
      type: 'text',
      content: `[File: ${originalName}] — Failed to read: ${err.message}`,
      extractedText: null,
      canAnalyze: false
    };
  }
}

/**
 * Check if a file is likely a text file
 */
function isTextFile(mimeType, ext) {
  const textMimes = ['text/', 'application/json', 'application/javascript', 'application/xml', 'application/x-yaml'];
  if (textMimes.some(m => mimeType?.startsWith(m) || mimeType === m)) return true;
  
  const textExts = [
    '.txt', '.md', '.csv', '.json', '.xml', '.yaml', '.yml',
    '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h',
    '.cs', '.rb', '.go', '.rs', '.php', '.swift', '.kt', '.scala',
    '.html', '.css', '.scss', '.sass', '.less',
    '.sql', '.sh', '.bash', '.zsh', '.bat', '.ps1',
    '.env', '.gitignore', '.dockerfile', '.toml', '.ini', '.cfg',
    '.log', '.r', '.m', '.lua', '.pl', '.ex', '.exs', '.hs',
    '.vue', '.svelte', '.astro'
  ];
  return textExts.includes(ext);
}

/**
 * Resolve file path relative to project root
 */
function resolveFilePath(filePath) {
  if (path.isAbsolute(filePath)) return filePath;
  // Handle paths like /uploads/images/file.jpg
  const cleaned = filePath.replace(/^\//, '');
  return path.resolve(__dirname, '..', cleaned);
}

module.exports = {
  analyzeFile
};
