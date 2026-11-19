const express = require('express');
const locationRoutes = require('./routes/locationRoutes');
const {notFound, errorHandler} = require('./middleware/errorHandler');

const app = express();


app.disable('x-powered-by');
app.use(express.json());

app.get('/health', (_req,res)=>{
    res.json({service: 'location-service', ok:true});
});

app.use(locationRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
