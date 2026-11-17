import { MessageFlags } from 'discord.js';
import { createActivityStore, quizPayload } from '../../../services/ai/activities.js';
export default {
 name:'ai_quiz',
 async execute(interaction,client,args){
  const [id,choice]=args;
  if(interaction.guildId!==client.homeGuildId||!interaction.guild||interaction.user.bot||!/^[a-f0-9]{20}$/.test(id||'')||!/^[0-3]$/.test(choice||'')||args.length!==2)return interaction.reply({content:'Ronde tidak valid.',flags:MessageFlags.Ephemeral});
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  try{const result=await createActivityStore(client).answer(interaction.guildId,id,interaction.message.id,interaction.user.id,Number(choice),Date.now());
   // Whether the answer was right is told when the timer ends (the ended message lists the winners and the correct option); until then every answer gets the same neutral acknowledgement.
   const RECORDED='✅ Jawaban kamu telah direkam! Tunggu waktu habis untuk melihat hasilnya.';
   const text={closed:'Ronde sudah ditutup atau tidak tersedia.',expired:'Waktu sudah habis. Kalau ada yang benar, hadiahnya dibagikan saat ronde berakhir.',full:'Ronde penuh.',answered:'Kamu sudah menjawab ronde ini.',wrong:RECORDED,correct:RECORDED}[result.status]||'Ronde tidak tersedia.';
   await interaction.editReply({content:text,allowedMentions:{parse:[]}});
   // Correct answers no longer close the round; the ended message is posted when the timer expires. If the round already ran out, this click is what ends it: edit the message then.
   if(result.status==='expired')await interaction.message.edit(quizPayload(result.question,id,{state:result.winners?.length?'solved':'expired',winners:result.winners??[],reward:result.reward??0})).catch(()=>{});
  }catch{await interaction.editReply({content:'Tidak dapat memproses jawaban. Coba lagi.',allowedMentions:{parse:[]}}).catch(()=>{});}
 }
};
