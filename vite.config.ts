import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function unifiedLocationRequestFix(): Plugin {
  return {
    name: 'unified-location-request-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/main.tsx') && !id.endsWith('\\src\\main.tsx')) return null;

      const oldPayload = "const payload=requestMode?{...form,navigation_url:requestLink,waze_url:'',maps_url:'',coordinates:''}:form;";
      const newPayload = `const normalizedKm=String(form.km||'').trim().replace(/(?<=\\d)\\s*[:：]\\s*(?=\\d{3}(?:\\D|$))/g,'+');const link=requestLink.trim();const host=(()=>{try{return new URL(link).hostname.toLowerCase()}catch{return ''}})();const isWaze=host==='waze.com'||host.endsWith('.waze.com')||host==='waze.to'||host.endsWith('.waze.to');const isGoogle=host==='goo.gl'||host.endsWith('.goo.gl')||host==='google.com'||host.endsWith('.google.com')||host.startsWith('google.');const linkWarning=!isWaze&&!isGoogle?'⚠️ הקישור שהוזן לא זוהה אוטומטית כ-Waze או Google Maps. יש לבדוק אותו לפני אישור.\\nקישור שהוזן: '+link:'';const payload=requestMode?{...form,km:normalizedKm,waze_url:isWaze?link:'',maps_url:isWaze?'':link,coordinates:'',notes:linkWarning?[form.notes,linkWarning].filter(Boolean).join('\\n\\n'):form.notes}:form;`;

      if (!code.includes(oldPayload)) throw new Error('Unified location request payload marker was not found');

      let transformed = code.replace(oldPayload, newPayload);
      transformed = transformed.replace(
        '<input type="url" value={requestLink}',
        '<input type="text" inputMode="url" dir="ltr" value={requestLink}',
      );
      return { code: transformed, map: null };
    },
  };
}

export default defineConfig({
  plugins: [unifiedLocationRequestFix(), react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
