// frontend/src/types/tree.ts
export type Tree = {
  id: string;
  lat: number;
  lng: number;
  species?: string;
  dbh?: number;
  height?: number;
  volume?: number;
};
