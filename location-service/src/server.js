const app = require('./app');
const PORT = process.env.PORT||3003;

process.on('unhandledRejection',(err)=>{
    console.error('[location-service] unhandledRejection:',err);
});

app.listen(PORT,()=>{
    console.log(`[location-service] listening on :${PORT}`);
});
