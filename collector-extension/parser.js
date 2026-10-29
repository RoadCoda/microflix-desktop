export function parseViewerText(text){
 const clean=text.replace(/\u00a0/g,' ').replace(/[–−]/g,'-');
 const section=(start,end)=>{const at=clean.search(new RegExp('\\b'+start+'\\b','i'));if(at<0)return '';const tail=clean.slice(at+start.length);let cut=tail.length;for(const word of end){const i=tail.search(new RegExp('\\b'+word+'\\b','i'));if(i>=0)cut=Math.min(cut,i);}return tail.slice(0,cut);};
 const ageText=section('Age',['Gender','Locations','Most active']),genderText=section('Gender',['Age','Locations','Most active']),countryText=section('Locations',['Most active','Posts your','Creators your']);
 const age={},gender={},countries={};const pct='(<\\s*1\\s*%|(?:100|[0-9]{1,2})(?:\\.[0-9]{1,2})?\\s*%)';
 for(const m of ageText.matchAll(new RegExp('(18\\s*-\\s*24|25\\s*-\\s*34|35\\s*-\\s*44|45\\s*-\\s*54|55\\s*\\+)\\s*'+pct,'g')))age[m[1].replace(/\s/g,'')]=m[2].replace(/\s/g,'');
 for(const m of genderText.matchAll(new RegExp('\\b(Male|Female|Other)\\s*'+pct,'gi')))gender[m[1][0].toUpperCase()+m[1].slice(1).toLowerCase()]=m[2].replace(/\s/g,'');
 for(const m of countryText.matchAll(new RegExp("([A-Za-z][A-Za-z .,'’()\\[\\]\\-]*?)\\s*"+pct,'g'))){const label=m[1].trim().replace(/\s+/g,' ');if(label.length<=80)countries[label]=m[2].replace(/\s/g,'');}
 return {age,gender,countries};
}
export function csv(records){const escape=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';const rows=[['videoId','title','publishedAt','observedAt','dimension','label','percentage','notes']];for(const r of records){let n=0;for(const d of ['age','gender','countries'])for(const [k,v]of Object.entries(r[d])){rows.push([r.videoId,r.title,r.publishedAt,r.observedAt,d,k,v,r.notes]);n++;}if(r.overview){for(const [k,v] of Object.entries(r.overview)){if(k==='trafficSources'){for(const [label,value]of Object.entries(v))rows.push([r.videoId,r.title,r.publishedAt,r.observedAt,'trafficSources',label,value,r.notes]);}else rows.push([r.videoId,r.title,r.publishedAt,r.observedAt,'overview',k,v,r.notes]);}n++;}if(!n)rows.push([r.videoId,r.title,r.publishedAt,r.observedAt,'unavailable','','',r.notes]);}return rows.map(r=>r.map(escape).join(',')).join('\r\n');}

export function parseOverviewText(text,capturedAt=new Date().toISOString()){
 const posted=text.indexOf('Posted on');const clean=(posted>=0?text.slice(posted):text).replace(/\u00a0/g,' ');
 const get=(label,pattern)=>{const m=clean.match(new RegExp('(?:^|\\n)\\s*'+label+'\\s*('+pattern+')','i'));return m?m[1].trim():null;};
 const count='[0-9][0-9,]*(?:\\.[0-9]+)?\\s*[KMB]?';
 const duration='[0-9]+(?:\\.[0-9]+)?\\s*[dhms](?:\\s*:?\\s*[0-9]+(?:\\.[0-9]+)?\\s*[hms])*';
 const trafficSources={};const at=clean.indexOf('Traffic source');if(at>=0){const t=clean.slice(at+14).split('Search queries')[0];for(const m of t.matchAll(/(For You|Following|Personal profile|Search|Direct messages|Sound|Other)\s*(<\s*[0-9]+(?:\.[0-9]+)?\s*%|[0-9]+(?:\.[0-9]+)?\s*%)/g))trafficSources[m[1]]=m[2].replace(/\s/g,'');}
 const data={capturedAt,videoViews:get('Video views',count),totalPlayTime:get('Total play time',duration),averageWatchTime:get('Average watch time','[0-9]+(?:\\.[0-9]+)?\\s*s'),watchedFullVideo:get('Watched full video','[0-9]+(?:\\.[0-9]+)?\\s*%')?.replace(/\s/g,'')??null,newFollowers:get('New followers',count),trafficSources,notes:''};
 const missing=['videoViews','totalPlayTime','averageWatchTime','watchedFullVideo','newFollowers'].some(k=>data[k]===null);
 data.notes=missing?'Some Overview metrics were unavailable or processing at capture. Values are preserved as displayed.':'Overview values preserved as displayed. TikTok metrics may update at different times.';
 return data;
}
