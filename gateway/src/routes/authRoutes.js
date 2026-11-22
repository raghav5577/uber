const router = require('express').Router();
const express = require('express');
const ctrl = require('../controllers/authController');

router.post('/token', express.json(), ctrl.issueDevToken);

module.exports = router;