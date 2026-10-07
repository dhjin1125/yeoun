export type DreamTestExample = {
  id: string;
  label: string;
  dream: string;
  source?: {
    label: string;
    url: string | null;
  };
};
