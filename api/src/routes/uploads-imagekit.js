const ImageKit = require('imagekit');
const multer = require('multer');

const imagekit = new ImageKit({
  publicKey:  process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /^(image|video)\//.test(file.mimetype);
    cb(allowed ? null : new Error('Faqat rasm yoki video'), allowed);
  }
});

async function uploadToImageKit(buffer, originalName, isVideo = false) {
  const result = await imagekit.upload({
    file: buffer,
    fileName: `${Date.now()}_${originalName.replace(/[^a-zA-Z0-9.]/g, '_')}`,
    folder: `/onetable/${isVideo ? 'videos' : 'images'}`,
    useUniqueFileName: true,
    transformation: isVideo ? undefined : { pre: 'q-auto,f-auto' }
  });
  return { url: result.url, file_id: result.fileId, size: result.size };
}

function registerUploadRoutes(app, authMiddleware) {
  app.post('/api/uploads/image', authMiddleware, (req, res) => {
    upload.single('file')(req, res, async err => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'Fayl yuborilmadi' });
      try {
        const result = await uploadToImageKit(req.file.buffer, req.file.originalname);
        res.json({ url: result.url, file_id: result.file_id, size: result.size });
      } catch(e) {
        console.error('Upload error:', e);
        res.status(500).json({ error: e.message || 'Yuklab bo\'lmadi' });
      }
    });
  });

  app.post('/api/uploads/video', authMiddleware, (req, res) => {
    upload.single('file')(req, res, async err => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'Fayl yuborilmadi' });
      try {
        const result = await uploadToImageKit(req.file.buffer, req.file.originalname, true);
        res.json({ url: result.url, file_id: result.file_id });
      } catch(e) { res.status(500).json({ error: e.message }); }
    });
  });

  app.delete('/api/uploads/:file_id', authMiddleware, async (req, res) => {
    try {
      await imagekit.deleteFile(req.params.file_id);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
}

module.exports = { imagekit, uploadToImageKit, registerUploadRoutes };
