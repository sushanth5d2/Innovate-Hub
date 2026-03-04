const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const uploadDirs = ['./uploads/images', './uploads/files', './uploads/profiles', './uploads/community'];
uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = './uploads/files';
    
    // Check by field name first (most reliable)
    if (file.fieldname === 'profile_picture') {
      uploadPath = './uploads/profiles';
    } else if (file.fieldname === 'banner') {
      uploadPath = './uploads/community';
    } else if (file.fieldname === 'cover_photo') {
      uploadPath = './uploads/images';
    }
    // Then check path-specific routes
    else if (req.path.includes('profile') || req.originalUrl.includes('profile')) {
      uploadPath = './uploads/profiles';
    } else if (req.path.includes('communit') || req.originalUrl.includes('communit') || req.path.includes('groups')) {
      uploadPath = './uploads/community';
    } else if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      uploadPath = './uploads/images';
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp|bmp|pdf|doc|docx|txt|md|csv|mp4|mov|webm|m4a|mp3|wav|xlsx|xls|pptx|ppt/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  
  // Check MIME types more comprehensively
  const allowedMimeTypes = [
    // Images
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml',
    // Videos
    'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska',
    // Audio
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/webm', 'audio/m4a', 'audio/x-m4a',
    // Documents
    'application/pdf',
    'application/msword', // .doc
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.ms-excel', // .xls
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-powerpoint', // .ppt
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    // Text and code
    'text/plain', 'text/csv', 'text/markdown', 'text/html', 'text/css', 'text/xml',
    'text/javascript', 'text/x-python', 'text/x-java-source', 'text/x-c',
    'application/json', 'application/javascript', 'application/xml', 'application/x-yaml'
  ];
  
  const mimetypeValid = allowedMimeTypes.includes(file.mimetype) || file.mimetype.startsWith('text/');

  if (mimetypeValid && extname) {
    return cb(null, true);
  } else {
    // File rejected: invalid type
    cb(new Error(`Invalid file type: ${file.mimetype}. Only images, PDFs, documents, videos, and audio files are allowed.`));
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 104857600 // 100MB default (for video creator series up to 120s)
  },
  fileFilter: fileFilter
});

module.exports = upload;
