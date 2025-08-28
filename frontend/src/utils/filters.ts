import type { SearchFilters, TreePoint } from '../types/map';


export function applyFilters(items: TreePoint[], f: SearchFilters): TreePoint[] {
return items.filter(p => {
if (f.species && f.species.length && (!p.species || !f.species.includes(p.species))) return false;
if (typeof f.heightMin === 'number' && typeof p.height === 'number' && p.height < f.heightMin) return false;
if (typeof f.heightMax === 'number' && typeof p.height === 'number' && p.height > f.heightMax) return false;
if (typeof f.dbhMin === 'number' && typeof p.dbh === 'number' && p.dbh < f.dbhMin) return false;
if (typeof f.dbhMax === 'number' && typeof p.dbh === 'number' && p.dbh > f.dbhMax) return false;
return true;
});
}
