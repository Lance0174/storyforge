import { db } from '../db/schema'
import type { Project, Work, World, AgentRunRecord } from '../types'
import { effectiveWorkKind, effectiveNovelProfile } from '../workspace/work-kind'
import { readWorkLibraryProjectionV1, switchActiveWork } from '../workspace/works'
import { isShareableWorld } from '../world-engine/world-identity'
import { worldModulePath } from '../../components/world-engine/navigation'
import { flushPendingEditsV1 } from '../authoring/pending-edit-coordinator'
import { useProjectStore } from '../../stores/project'

export type HomeWork = {work: Work; project: Project; world: World}
export const workLabel = (w: Work) => w.kind === 'novel' ? effectiveNovelProfile(w) === 'short' ? '短篇' : '长篇' : ({screenplay:'剧本',comic:'漫画','motion-drama':'漫剧素材',avg:'AVG',ttrpg:'跑团','ai-town':'AI 小镇','character-interaction':'角色聊天'}[w.kind])
export function workPath(row: HomeWork, module = 'info'): string {
 const {work:w,project:p}=row
 if(w.kind==='comic')return `/comic/${module==='versions'?'versions':'source'}?work=${w.id}`
 if(w.kind==='character-interaction')return `/chat/${module==='versions'?'release':'vision'}?project=${p.id}&work=${w.id}`
 if(w.kind==='motion-drama')return `/motion/${module==='versions'?'versions':'source'}?work=${w.id}`
 if(w.kind==='ai-town')return `/town/${module==='versions'?'release':'vision'}?project=${p.id}&work=${w.id}`
 if(w.kind==='ttrpg')return `/ttrpg/${module==='versions'?'release':'vision'}?project=${p.id}&work=${w.id}`
 if(w.kind==='avg')return `/avg/${module==='versions'?'release':'vision'}?project=${p.id}`
 if(p.workspacePurpose==='world-engine')return worldModulePath(p.id!,module)
 if(effectiveWorkKind(w)==='screenplay')return `/script/${module==='versions'?'versions':'editor'}?work=${w.id}`
 if(w.kind==='novel'&&effectiveNovelProfile(w)==='short')return `/short/${module==='versions'?'versions':module==='info'?'intent':'editor'}?project=${p.id}`
 if(w.kind==='novel')return `/workspace/${p.id}?module=${module==='versions'?'version-history':module}`
 return `/home/detail?work=${w.id}`
}
export async function openHomeWork(row: HomeWork): Promise<void> {
 await flushPendingEditsV1()
 const current=await db.works.get(row.work.id!)
 if(!current||current.code!==row.work.code||current.projectId!==row.project.id||current.worldId!==row.world.id)throw new Error('作品已经变化或被移除，请刷新后重试。')
 await switchActiveWork(current.projectId,current.id!)
 await useProjectStore.getState().loadProjects()
}
export async function readHomeCatalog(){
 const [projects,works,worlds]=await Promise.all([db.projects.toArray(),db.works.toArray(),db.worlds.toArray()])
 const rows:HomeWork[]=works.flatMap(work=>{const project=projects.find(p=>p.id===work.projectId),world=worlds.find(w=>w.id===work.worldId&&w.projectId===work.projectId);return project&&world?[{work,project,world}]:[]}).sort((a,b)=>b.work.updatedAt-a.work.updatedAt)
 for (const row of rows) row.work = await readWorkLibraryProjectionV1(row.work)
 return {projects,rows,works:rows.filter(r=>r.project.workspacePurpose==='independent-work'),worlds:worlds.filter(w=>isShareableWorld(w)&&projects.some(p=>p.id===w.projectId&&p.activeWorldId===w.id)).sort((a,b)=>b.updatedAt-a.updatedAt)}
}
export const RUN_LABELS:Record<string,string>={planned:'待开始',running:'进行中',awaiting_confirmation:'待确认',verifying:'校验中',completed:'已完成',paused:'已暂停',recovering:'恢复中',failed:'失败',cancelled:'已取消',recovery_required:'需要恢复'}
export function runSummary(run:AgentRunRecord){
 try{const contract=JSON.parse(run.contractJson);return {title:typeof contract.objective==='string'?contract.objective:'创作任务',contract}}catch{return {title:'运行记录损坏',contract:null}}
}
const RESUME_KEY='storyforge.home.resume.v1'
export function rememberHomeWork(row:HomeWork,path:string){
 if(row.project.workspacePurpose!=='independent-work'||!validWorkPath(row,path))return
 try{localStorage.setItem(RESUME_KEY,JSON.stringify({workId:row.work.id,workCode:row.work.code,path}));window.dispatchEvent(new Event('storyforge-home-resume'))}catch{/* Navigation remains usable when storage is unavailable. */}
}
export function validWorkPath(row:HomeWork,path:string){
 if(!path.startsWith('/')||path.startsWith('//'))return false
 const u=new URL(path,'https://storyforge.local')
 if(u.origin!=='https://storyforge.local')return false
 const w=row.work
 if(w.kind==='comic')return /^\/comic\/(source|facts|causal|brief|decisions|script|rhythm|layout|lettering|visual|references|media|review|preview|versions|settings)$/.test(u.pathname)&&u.searchParams.get('work')===String(w.id)
 if(w.kind==='ai-town')return /^\/town\//.test(u.pathname)&&u.searchParams.get('project')===String(w.projectId)&&u.searchParams.get('work')===String(w.id)
 if(w.kind==='ttrpg')return /^\/ttrpg\//.test(u.pathname)&&u.searchParams.get('project')===String(w.projectId)&&u.searchParams.get('work')===String(w.id)
 if(w.kind==='motion-drama')return /^\/motion\/(source|series|episodes|assets|beats|script|shots|frames|image|video|pack|review|versions|prompts|settings)$/.test(u.pathname)&&u.searchParams.get('work')===String(w.id)
 if(w.kind==='character-interaction')return /^\/chat\//.test(u.pathname)&&u.searchParams.get('project')===String(w.projectId)&&u.searchParams.get('work')===String(w.id)
 if(w.kind==='avg')return /^\/avg\//.test(u.pathname)&&u.searchParams.get('project')===String(w.projectId)
 if(w.kind==='novel'&&effectiveNovelProfile(w)==='long')return u.pathname===`/workspace/${w.projectId}`
 if(w.kind==='novel')return /^\/short\/(intent|story|chapters|editor|review|versions|derive)$/.test(u.pathname)&&u.searchParams.get('project')===String(w.projectId)
 if(w.kind==='screenplay')return /^\/script\/(source|brief|structure|scenes|editor|grounding|review|versions)$/.test(u.pathname)&&u.searchParams.get('work')===String(w.id)
 return false
}
export function readHomeResume(rows:HomeWork[]):{row:HomeWork;path:string}|null{
 try{const saved=JSON.parse(localStorage.getItem(RESUME_KEY)||'null');const row=rows.find(r=>r.work.id===saved?.workId&&r.work.code===saved?.workCode);if(row&&typeof saved.path==='string'&&validWorkPath(row,saved.path))return {row,path:saved.path}}catch{/* Ignore invalid or inaccessible local navigation state. */}
 const row=rows[0];return row?{row,path:workPath(row)}:null
}

/** Route known formal tasks back to the existing editor; never infer an adoption action. */
export function runWorkPath(row: HomeWork, run: AgentRunRecord): string {
 const {contract}=runSummary(run)
 const targets: string[]=Array.isArray(contract?.permissions?.writeTargets)?contract.permissions.writeTargets.map((t:{table?:string}|null)=>t?.table).filter((t:unknown)=>typeof t==='string'):[]
 const skills: string[]=Array.isArray(contract?.executionBindings)?contract.executionBindings.map((b:{skillId?:string}|null)=>b?.skillId).filter((s:unknown)=>typeof s==='string'):[]
 let module='info'
 if(targets.includes('outlineNodes'))module='outline'
 if(targets.includes('detailedOutlines'))module='detailed-outline'
 if(targets.includes('characters'))module='characters-main'
 if(targets.includes('worldviews'))module='world-rules'
 if(targets.includes('chapters'))module='chapters-list'
 if(skills.some(s=>s.includes('map')))module='world-map'
 if(skills.some(s=>s.includes('story-arc')))module='story-arc'
 const chapters=contract?.scope?.outlineNodeIds
 let path=workPath(row,module)
 if(module==='chapters-list'&&row.work.kind==='novel'&&row.work.novelProfile==='long'&&Number.isInteger(chapters?.[0])&&chapters[0]>0)path+=`&chapter=${chapters[0]}`
 return path
}
