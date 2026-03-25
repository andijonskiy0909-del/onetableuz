const reservationService = require('../services/reservationService');
const reservationRepo = require('../repositories/reservationRepository');

exports.createReservation = async (req, res, next) => {
  try {
    const reservation = await reservationService.createReservation(req.user.id, req.body);
    res.status(201).json(reservation);
  } catch (err) {
    if (err.message.includes('No available slots') || err.message.includes('blocked')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
};

exports.getMyReservations = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const reservations = await reservationRepo.findByUser(req.user.id, page, limit);
    res.json(reservations);
  } catch (err) {
    next(err);
  }
};

exports.cancelReservation = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const reservation = await reservationRepo.findById(id);
    if (!reservation || reservation.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    if (reservation.status === 'cancelled') {
      return res.status(400).json({ error: 'Already cancelled' });
    }
    // Check if reservation date is in the past
    const bookingDate = new Date(`${reservation.date}T${reservation.time}`);
    if (bookingDate < new Date()) {
      return res.status(400).json({ error: 'Cannot cancel past reservation' });
    }
    await reservationRepo.updateStatus(id, 'cancelled');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
