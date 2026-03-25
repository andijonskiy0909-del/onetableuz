const router = require('express').Router();
const { userAuth } = require('../../middleware/auth');
const { validateReservation } = require('../../middleware/validation');
const reservationController = require('../../controllers/reservationController');

router.post('/', userAuth, validateReservation, reservationController.createReservation);
router.get('/my', userAuth, reservationController.getMyReservations);
router.delete('/:id', userAuth, reservationController.cancelReservation);

module.exports = router;
