export type LayerKind = 'basemap' | 'raster' | 'vector';


export type MapLayer = {
id: string;
name: string;
kind: LayerKind;
group: '基図' | 'ラスタ' | 'ベクタ';
visible: boolean;
opacity: number; // 0..1
};


export type TreePoint = {
id: string;
lat: number;
lng: number;
species?: string; // 樹種
height?: number; // 樹高(m)
dbh?: number; // 胸高直径(cm)
volume?: number; // 材積(m3)
};


export type SearchFilters = {
species?: string[]; // IN 条件
heightMin?: number;
heightMax?: number;
dbhMin?: number;
dbhMax?: number;
};
