const { Router } = require('express');
const multer = require('multer');
const { validate } = require('../middleware/validate');
const { authenticate, requireEditor, requireAdmin } = require('../middleware/authenticate');
const { env } = require('../config/env');
const { upload, preview, plan, commit, rollback, list, getById } = require('../controllers/import.controller');
const {
  list: listTemplates,
  create: createTemplate,
  update: updateTemplate,
  remove: removeTemplate,
} = require('../controllers/mappingTemplate.controller');
const { planValidation, templateValidation } = require('../validators/import.validators');

const XLSX_MIME = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
];

// Files are buffered in memory, hashed, then written under a hash-derived
// name — the client-supplied filename never reaches the filesystem.
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const isXlsx = /\.xlsx$/i.test(file.originalname) && XLSX_MIME.includes(file.mimetype);
    cb(null, isXlsx);
  },
}).single('file');

const importRouter = Router();

importRouter.get('/', authenticate, list);
importRouter.get('/:id', authenticate, getById);
importRouter.get('/:id/preview', authenticate, preview);

importRouter.post('/', authenticate, requireEditor, uploadMiddleware, upload);
importRouter.post('/:id/plan', authenticate, requireEditor, planValidation, validate, plan);
importRouter.post('/:id/commit', authenticate, requireEditor, commit);
// Rollback deletes data, so it is admin-only.
importRouter.post('/:id/rollback', authenticate, requireAdmin, rollback);

const templateRouter = Router();
templateRouter.get('/', authenticate, listTemplates);
templateRouter.post('/', authenticate, requireEditor, templateValidation, validate, createTemplate);
templateRouter.put('/:id', authenticate, requireEditor, updateTemplate);
templateRouter.delete('/:id', authenticate, requireEditor, removeTemplate);

module.exports = { importRouter, templateRouter };
