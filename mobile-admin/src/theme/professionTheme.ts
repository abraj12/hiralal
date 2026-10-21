export type ProfessionType = 'PLUMBER' | 'TILE_INSTALLER';

export interface ThemeConfig {
  profession: ProfessionType | 'NEUTRAL';
  displayName: string;
  tagline: string;
  primaryColor: string;
  primaryDark: string;
  primaryLight: string;
  badgeBg: string;
  badgeText: string;
  rewardTitle: string;
  uploadTitle: string;
  myRewardsTitle: string;
  redeemTitle: string;
  recentActivityTitle: string;
  bannerAsset: any;
  cardAsset: any;
  workerAsset: any;
  subcategories: string[];
}

export const THEMES: Record<ProfessionType, ThemeConfig> = {
  PLUMBER: {
    profession: 'PLUMBER',
    displayName: 'Plumber',
    tagline: 'Earn rewards on genuine plumbing purchases.',
    primaryColor: '#1E60D5',
    primaryDark: '#0D47A1',
    primaryLight: '#EBF3FE',
    badgeBg: '#DBEAFE',
    badgeText: '#1D4ED8',
    rewardTitle: 'Plumbing Rewards',
    uploadTitle: 'Upload Plumbing Bill',
    myRewardsTitle: 'My Plumbing Rewards',
    redeemTitle: 'Redeem Plumbing Rewards',
    recentActivityTitle: 'Recent Plumbing Bills',
    bannerAsset: require('../../assets/plumber_hero.png'),
    cardAsset: require('../../assets/plumber_card.png'),
    workerAsset: require('../../assets/worker_plumber.png'),
    subcategories: ['Pipes', 'Fittings', 'Sanitary', 'Fixtures'],
  },
  TILE_INSTALLER: {
    profession: 'TILE_INSTALLER',
    displayName: 'Tile Installer',
    tagline: 'Earn rewards on genuine tile purchases.',
    primaryColor: '#E65100',
    primaryDark: '#BF360C',
    primaryLight: '#FFF3E0',
    badgeBg: '#FFEDD5',
    badgeText: '#C2410C',
    rewardTitle: 'Tile Rewards',
    uploadTitle: 'Upload Tile Bill',
    myRewardsTitle: 'My Tile Rewards',
    redeemTitle: 'Redeem Tile Rewards',
    recentActivityTitle: 'Recent Tile Bills',
    bannerAsset: require('../../assets/tiles_hero.png'),
    cardAsset: require('../../assets/tiles_card.png'),
    workerAsset: require('../../assets/worker_tile.png'),
    subcategories: ['Tiles', 'Adhesives', 'Grouts', 'Tools'],
  },
};

export const NEUTRAL_THEME: ThemeConfig = {
  profession: 'NEUTRAL',
  displayName: 'Rewards Partner',
  tagline: 'Earn exciting rewards on genuine purchases from Hiralal & Sons.',
  primaryColor: '#1E60D5',
  primaryDark: '#1548A6',
  primaryLight: '#F1F5F9',
  badgeBg: '#E2E8F0',
  badgeText: '#334155',
  rewardTitle: 'Rewards Program',
  uploadTitle: 'Upload Purchase Bill',
  myRewardsTitle: 'My Rewards',
  redeemTitle: 'Redeem Rewards',
  recentActivityTitle: 'Recent Bills',
  bannerAsset: require('../../assets/welcome_neutral.png'),
  cardAsset: require('../../assets/rewards_illustration.png'),
  workerAsset: require('../../assets/hero_neutral.png'),
  subcategories: ['Plumbing', 'Tiles & Sanitary'],
};
