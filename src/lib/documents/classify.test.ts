import {it,expect} from 'vitest';
import {classifyDocument} from './classify';
const types=[{id:'nda',category_id:'legal',name:'Non disclosure agreement',code:'nda'},{id:'deck',category_id:'finance',name:'Pitch deck',code:'pitch_deck'}];
it('proposes metadata only with unambiguous type and valid date evidence',()=>{expect(classifyDocument('NDA_2026-10-01.pdf','Non disclosure agreement',types)).toMatchObject({typeId:'nda',date:'2026-10-01',confidence:'rule'});expect(classifyDocument('unknown.pdf','Pitch deck and non disclosure agreement 2026-02-31',types)).toMatchObject({typeId:null,date:null,confidence:'review'});});
it('does not infer execution or signing from a filename',()=>{expect(classifyDocument('signed_nda.pdf','',types).status).toBe('RECEIVED');});
