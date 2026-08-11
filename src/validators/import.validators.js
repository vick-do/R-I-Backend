const { body } = require('express-validator');
const MappingTemplate = require('../models/MappingTemplate.model');

const planValidation = [
  body('sheet').isString().trim().notEmpty().withMessage('Choose a sheet to import.'),
  body('program').isString().trim().notEmpty().withMessage('Choose the programme this data belongs to.'),
  body('mapping').optional().isObject(),
  body('mapping.layout')
    .optional()
    .isIn(MappingTemplate.LAYOUTS)
    .withMessage(`Layout must be one of: ${MappingTemplate.LAYOUTS.join(', ')}.`),
  body('mappingTemplate').optional().isMongoId().withMessage('Invalid mapping template id.'),
];

const templateValidation = [
  body('name').isString().trim().notEmpty().withMessage('Give the template a name.'),
  body('layout')
    .isIn(MappingTemplate.LAYOUTS)
    .withMessage(`Layout must be one of: ${MappingTemplate.LAYOUTS.join(', ')}.`),
  body('percentScale').optional().isIn(['fraction', 'percent']),
  body('columns').optional().isArray(),
  body('crosstab').optional().isObject(),
];

module.exports = { planValidation, templateValidation };
