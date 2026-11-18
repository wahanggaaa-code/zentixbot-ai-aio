import express from 'express';
import { botOwnerIds } from './settingsApi.js';
import { botPresenceFor } from '../services/botPresence.js';

export function createBotPresenceApi(client, {auth, csrf, env=process.env, service=botPresenceFor(client)}) {
 const router=express.Router();
 const owner=(req,res,next)=>botOwnerIds(env).includes(req.session.user.id) ? next() : res.status(403).json({error:'Status bot hanya untuk owner bot.'});
 const fail=(res,e)=>res.status(e.status===400?400:503).json({error:e.status===400?e.message:'Status bot tidak dapat dimuat atau disimpan; periksa database dan muat ulang untuk memastikan hasilnya.'});
 router.get('/presence',auth,owner,async(req,res)=>{try{res.json({settings:await service.read()})}catch(e){fail(res,e)}});
 router.patch('/presence',auth,owner,csrf,express.json({limit:'2kb'}),async(req,res)=>{try{res.json({ok:true,...await service.save(req.body)})}catch(e){fail(res,e)}});
 return router;
}
