const Joi = require('joi');

const reservationSchema = Joi.object({
  restaurant_id: Joi.number().integer().required(),
  date: Joi.date().greater('now').required(),
  time: Joi.string().pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).required(),
  guests: Joi.number().integer().min(1).max(20).required(),
  comment: Joi.string().max(500).allow(''),
  zone_id: Joi.number().integer().allow(null),
  pre_order: Joi.array()
});

const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  next();
};

module.exports = {
  validateReservation: validate(reservationSchema)
};
