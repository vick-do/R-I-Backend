/**
 * Registers every model with Mongoose.
 *
 * Requiring this barrel (rather than individual models) guarantees that
 * `populate()` across collections resolves — a model referenced only by a
 * populate path is otherwise never loaded, and fails at request time.
 */
module.exports = {
  User: require('./User.model'),
  Program: require('./Program.model'),
  Metric: require('./Metric.model'),
  Dimension: require('./Dimension.model'),
  Fact: require('./Fact.model'),
  Target: require('./Target.model'),
  ImportBatch: require('./ImportBatch.model'),
  MappingTemplate: require('./MappingTemplate.model'),
  SheetSource: require('./SheetSource.model'),
  FactSubmission: require('./FactSubmission.model'),
  AuditLog: require('./AuditLog.model'),
};
