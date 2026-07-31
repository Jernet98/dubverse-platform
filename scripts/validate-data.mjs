import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'data/seed.json'), 'utf8'));
const projectIds = new Set(seed.projects.map(item => item.id));
const studioIds = new Set(seed.studios.map(item => item.id));
const episodeIds = new Set();
const errors = [];

for (const project of seed.projects) {
  for (const key of ['poster', 'banner']) {
    const value = project[key];
    if (value?.startsWith('/')) {
      const file = path.join(root, 'public', value.slice(1));
      if (!fs.existsSync(file)) errors.push(`Falta ${key} de ${project.id}: ${value}`);
    }
  }
}
for (const studio of seed.studios) {
  if (studio.logo?.startsWith('/')) {
    const file = path.join(root, 'public', studio.logo.slice(1));
    if (!fs.existsSync(file)) errors.push(`Falta logo de ${studio.id}: ${studio.logo}`);
  }
}
for (const relation of seed.projectStudios) {
  if (!projectIds.has(relation.projectId)) errors.push(`Relación con proyecto inexistente: ${relation.projectId}`);
  if (!studioIds.has(relation.studioId)) errors.push(`Relación con estudio inexistente: ${relation.studioId}`);
}
for (const episode of seed.episodes) {
  if (episodeIds.has(episode.id)) errors.push(`Episodio duplicado: ${episode.id}`);
  episodeIds.add(episode.id);
  if (!projectIds.has(episode.projectId)) errors.push(`Episodio ${episode.id} con proyecto inexistente`);
  if (!episode.videoUrl) errors.push(`Episodio sin URL: ${episode.id}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: ${seed.projects.length} proyectos, ${seed.studios.length} estudios, ${seed.episodes.length} episodios y ${seed.projectStudios.length} relaciones.`);
