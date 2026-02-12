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
    
    // Log for debugging
    console.log('Upload middleware - req.path:', req.path);
    console.log('Upload middleware - req.originalUrl:', req.originalUrl);
    console.log('Upload middleware - fieldname:', file.fieldname);
    
    // Check by field name first (most reliable)
    if (file.fieldname === 'profile_picture') {
      uploadPath = './uploads/profiles';
      console.log('Using profiles folder (from fieldname)');
    } else if (file.fieldname === 'banner') {
      uploadPath = './uploads/community';
      console.log('Using community folder (from fieldname)');
    } else if (file.fieldname === 'cover_photo') {
      uploadPath = './uploads/images';
      console.log('Using images folder (from cover_photo fieldname)');
    }
    // Then check path-specific routes
    else if (req.path.includes('profile') || req.originalUrl.includes('profile')) {
      uploadPath = './uploads/profiles';
      console.log('Using profiles folder (from path)');
    } else if (req.path.includes('communit') || req.originalUrl.includes('communit') || req.path.includes('groups')) { // matches communities, community-groups, and groups
      uploadPath = './uploads/community';
      console.log('Using community folder (from path)');
    } else if (file.mimetype.startsWith('image/')) {
      uploadPath = './uploads/images';
      console.log('Using images folder (generic)');
    }
    
    console.log('Final upload path:', uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp|bmp|svg|pdf|doc|docx|txt|md|csv|json|xml|yaml|yml|js|ts|py|java|cpp|c|html|css|sql|sh|mp4|mov|webm|m4a|mp3|wav|xlsx|xls|pptx|ppt/;
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

  if (mimetypeValid || extname) {
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
