/**
 * Lanhu URL parsing helpers.
 */

import { InvalidUrlError } from './error.js';

export interface ParsedLanhuUrl {
  teamId?: string;
  projectId: string;
  imageId: string;
}

export function parseLanhuUrl(url: string): ParsedLanhuUrl {
  try {
    const urlObj = new URL(url);

    if (!urlObj.hostname.includes('lanhuapp.com')) {
      throw new InvalidUrlError('URL must use lanhuapp.com');
    }

    const hash = urlObj.hash;
    if (!hash || !hash.includes('?')) {
      throw new InvalidUrlError('Lanhu URL is missing hash query parameters');
    }

    const queryString = hash.split('?')[1];
    const params = new URLSearchParams(queryString);

    const teamId = params.get('tid') || params.get('team_id') || undefined;
    const projectId = params.get('pid') || params.get('project_id');
    const imageId = params.get('image_id');

    if (!projectId || !imageId) {
      const missing: string[] = [];
      if (!projectId) missing.push('pid/project_id');
      if (!imageId) missing.push('image_id');
      throw new InvalidUrlError(`Lanhu URL is missing required params: ${missing.join(', ')}`);
    }

    return {
      teamId,
      projectId,
      imageId,
    };
  } catch (error) {
    if (error instanceof InvalidUrlError) {
      throw error;
    }

    throw new InvalidUrlError(`Failed to parse Lanhu URL: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function buildApiUrl(params: ParsedLanhuUrl): string {
  const searchParams = new URLSearchParams({
    dds_status: '1',
    image_id: params.imageId,
    project_id: params.projectId,
    all_versions: '0',
  });

  if (params.teamId) {
    searchParams.set('team_id', params.teamId);
  }

  return `https://lanhuapp.com/api/project/image?${searchParams.toString()}`;
}
