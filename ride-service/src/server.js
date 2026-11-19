const app = require('./app');
const migrate = require('./config/migrate');

const PORT = process.env.PORT|| 3001;
process.on('unhandledRejection',(err)=>{
    console.error('[ride-service] unhandledRejetion:',err );
});

async function start(){
    try{
        await migrate();

        app.listen(PORT,()=>{
            console.log(`[ride-service] listening on :${PORT}`);
        });
    }
    catch(err){
        console.error('[ride-service] startup failed:', err.message);
        process.exit(1);
    }
}

start();
