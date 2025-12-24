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
    
    if (file.mimetype.startsWith('image/')) {
      uploadPath = './uploads/images';
    }
    
    if (req.path.includes('profile')) {
      uploadPath = './uploads/profiles';
    }
    
    if (req.path.includes('community')) {
      uploadPath = './uploads/community';
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
  const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|mp4|mov|webm|m4a|mp3|wav/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  
  // Check MIME types more comprehensively
  const allowedMimeTypes = [
    // Images
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    // Videos
    'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska',
    // Audio
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/webm', 'audio/m4a', 'audio/x-m4a',
    // Documents
    'application/pdf',
    'application/msword', // .doc
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'text/plain', // .txt
    'application/vnd.ms-excel', // .xls
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' // .xlsx
  ];
  
  const mimetypeValid = allowedMimeTypes.includes(file.mimetype);

  if ((mimetypeValid || extname) && extname) {
    return cb(null, true);
  } else {
    console.log('Rejected file:', file.originalname, 'MIME:', file.mimetype);
    cb(new Error(`Invalid file type: ${file.mimetype}. Only images, PDFs, documents, videos, and audio files are allowed.`));
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 52428800 // 50MB default (increased for documents/videos)
  },
  fileFilter: fileFilter
});

module.exports = upload;
