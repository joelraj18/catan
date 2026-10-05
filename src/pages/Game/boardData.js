// Static MANAPALLY board data shared by the game engine, the board view and
// the landing page: the 40 spaces, their grid positions and both card decks.

export const STARTING_BALANCE = 1500000; // ₹15,00,000

// Board landmarks the card decks steer players toward.
export const ROUTE_SPACES = [5, 15, 25, 35];
export const UTILITY_SPACES = [12, 28];
export const DETENTION_SPACE = 10;
export const GO_TO_DETENTION_SPACE = 30;
export const START_SPACE = 0;

// The two decks. Each card carries its printed text plus a machine readable
// effect that the game engine applies.
export const CHANCE_DECK = [
  { text: 'Advance to Jubilee', effect: { kind: 'advance', target: 39 } },
  { text: 'Advance to Go and collect ₹2,00,000', effect: { kind: 'advance', target: START_SPACE } },
  { text: 'Advance to Adoni, if you pass Go collect ₹2,00,000', effect: { kind: 'advance', target: 24 } },
  { text: 'Advance to Guntur, if you pass Go collect ₹2,00,000', effect: { kind: 'advance', target: 11 } },
  {
    text: 'Advance to the nearest Express station, if it is unowned you may buy it from the Bank and if it is owned pay the owner twice the usual rent',
    effect: { kind: 'nearest-route' },
  },
  {
    text: 'Advance to the nearest Express station, if it is unowned you may buy it from the Bank and if it is owned pay the owner twice the usual rent',
    effect: { kind: 'nearest-route' },
  },
  {
    text: 'Advance to the nearest Utility, if it is unowned you may buy it from the Bank and if it is owned throw the dice and pay the owner ten times the amount thrown × ₹1,000',
    effect: { kind: 'nearest-utility' },
  },
  { text: 'The bank pays you a dividend of ₹50,000', effect: { kind: 'collect', amount: 50000 } },
  { text: 'Get Out of Jail Free', effect: { kind: 'pardon' } },
  { text: 'Go back 3 spaces', effect: { kind: 'back', steps: 3 } },
  { text: 'Go directly to Jail, do not pass Go and do not collect ₹2,00,000', effect: { kind: 'detention' } },
  {
    text: 'Make general repairs on all your property, pay ₹25,000 for each house and ₹1,00,000 for each hotel',
    effect: { kind: 'repairs', perHouse: 25000, perHotel: 100000 },
  },
  { text: 'Speeding fine of ₹15,000', effect: { kind: 'pay', amount: 15000 } },
  { text: 'Take a trip to Secunderabad station, if you pass Go collect ₹2,00,000', effect: { kind: 'advance', target: 5 } },
  { text: 'You have been elected Chairman of the Board, pay each player ₹50,000', effect: { kind: 'pay-each', amount: 50000 } },
  { text: 'Your building loan matures, collect ₹1,50,000', effect: { kind: 'collect', amount: 150000 } },
];

export const COMMUNITY_DECK = [
  { text: 'Advance to Go and collect ₹2,00,000', effect: { kind: 'advance', target: START_SPACE } },
  { text: 'Bank error in your favour, collect ₹2,00,000', effect: { kind: 'collect', amount: 200000 } },
  { text: "Doctor's fee, pay ₹50,000", effect: { kind: 'pay', amount: 50000 } },
  { text: 'From the sale of stock you get ₹50,000', effect: { kind: 'collect', amount: 50000 } },
  { text: 'Get Out of Jail Free', effect: { kind: 'pardon' } },
  { text: 'Go directly to Jail, do not pass Go and do not collect ₹2,00,000', effect: { kind: 'detention' } },
  { text: 'Holiday fund matures, receive ₹1,00,000', effect: { kind: 'collect', amount: 100000 } },
  { text: 'Income tax refund, collect ₹20,000', effect: { kind: 'collect', amount: 20000 } },
  { text: 'It is your birthday, collect ₹10,000 from every player', effect: { kind: 'collect-each', amount: 10000 } },
  { text: 'Life insurance matures, collect ₹1,00,000', effect: { kind: 'collect', amount: 100000 } },
  { text: 'Pay hospital fees of ₹1,00,000', effect: { kind: 'pay', amount: 100000 } },
  { text: 'Pay school fees of ₹50,000', effect: { kind: 'pay', amount: 50000 } },
  { text: 'Receive a ₹25,000 consultancy fee', effect: { kind: 'collect', amount: 25000 } },
  {
    text: 'You are assessed for street repair, ₹40,000 per house and ₹1,15,000 per hotel',
    effect: { kind: 'repairs', perHouse: 40000, perHotel: 115000 },
  },
  { text: 'You have won second prize in a beauty contest, collect ₹10,000', effect: { kind: 'collect', amount: 10000 } },
  { text: 'You inherit ₹1,00,000', effect: { kind: 'collect', amount: 100000 } },
];

// Older names for the two decks, kept so existing imports still work.
export const RAJAS_ORDER_DECK = CHANCE_DECK;
export const TEMPLE_HUNDI_DECK = COMMUNITY_DECK;

// The 40 spaces, themed on the cities and neighbourhoods of Andhra Pradesh
// and Telangana. `art` picks the illustration a special tile shows; express
// stations carry a `line` so each plays its own train sound.
export const BOARD_SPACES = [
  // Bottom row, from the Go corner leftwards
  { id: 0, name: 'Go', subname: 'Collect ₹2,00,000', type: 'start', art: 'go' },
  { id: 1, name: 'Koti', type: 'property', colorGroup: 'maroon', price: 60000 },
  { id: 2, name: 'Community Chest', type: 'community', art: 'chest' },
  { id: 3, name: 'Abids', type: 'property', colorGroup: 'maroon', price: 60000 },
  { id: 4, name: 'Income Tax', type: 'tax', art: 'tax', taxLabel: 'Pay ₹2,00,000' },
  { id: 5, name: 'Secunderabad', subname: 'Express', type: 'route', art: 'train', line: 'pallavan', price: 200000 },
  { id: 6, name: 'Uppal', type: 'property', colorGroup: 'peacock', price: 100000 },
  { id: 7, name: 'Chance', type: 'chance', art: 'chance' },
  { id: 8, name: 'Alwal', type: 'property', colorGroup: 'peacock', price: 100000 },
  { id: 9, name: 'Medchal', type: 'property', colorGroup: 'peacock', price: 120000 },

  // Corner
  { id: 10, name: 'Jail', subname: 'Just Visiting', type: 'detention', art: 'jail' },

  // Left column, moving up
  { id: 11, name: 'Guntur', type: 'property', colorGroup: 'rose', price: 140000 },
  { id: 12, name: 'Power', subname: 'Utility', type: 'utility', art: 'power', price: 150000 },
  { id: 13, name: 'Tenali', type: 'property', colorGroup: 'rose', price: 140000 },
  { id: 14, name: 'Chirala', type: 'property', colorGroup: 'rose', price: 160000 },
  { id: 15, name: 'Vijayawada', subname: 'Express', type: 'route', art: 'train', line: 'farakka', price: 200000 },
  { id: 16, name: 'Nellore', type: 'property', colorGroup: 'saffron', price: 180000 },
  { id: 17, name: 'Community Chest', type: 'community', art: 'chest' },
  { id: 18, name: 'Ongole', type: 'property', colorGroup: 'saffron', price: 180000 },
  { id: 19, name: 'Kavali', type: 'property', colorGroup: 'saffron', price: 200000 },

  // Corner
  { id: 20, name: 'Free Parking', type: 'parking', art: 'parking' },

  // Top row, moving right
  { id: 21, name: 'Kurnool', type: 'property', colorGroup: 'kumkum', price: 220000 },
  { id: 22, name: 'Chance', type: 'chance', art: 'chance' },
  { id: 23, name: 'Kadapa', type: 'property', colorGroup: 'kumkum', price: 220000 },
  { id: 24, name: 'Adoni', type: 'property', colorGroup: 'kumkum', price: 240000 },
  { id: 25, name: 'Kacheguda', subname: 'Express', type: 'route', art: 'train', line: 'pallavan', price: 200000 },
  { id: 26, name: 'Warangal', type: 'property', colorGroup: 'turmeric', price: 260000 },
  { id: 27, name: 'Khammam', type: 'property', colorGroup: 'turmeric', price: 260000 },
  { id: 28, name: 'Water', subname: 'Utility', type: 'utility', art: 'water', price: 150000 },
  { id: 29, name: 'Siddipet', type: 'property', colorGroup: 'turmeric', price: 280000 },

  // Corner
  { id: 30, name: 'Go to Jail', type: 'go-to-detention', art: 'goToJail' },

  // Right column, moving down
  { id: 31, name: 'Vizag', type: 'property', colorGroup: 'emerald', price: 300000 },
  { id: 32, name: 'Kakinada', type: 'property', colorGroup: 'emerald', price: 300000 },
  { id: 33, name: 'Community Chest', type: 'community', art: 'chest' },
  { id: 34, name: 'Eluru', type: 'property', colorGroup: 'emerald', price: 320000 },
  { id: 35, name: 'Tirupati', subname: 'Express', type: 'route', art: 'train', line: 'farakka', price: 200000 },
  { id: 36, name: 'Chance', type: 'chance', art: 'chance' },
  { id: 37, name: 'Banjara', type: 'property', colorGroup: 'indigo', price: 350000 },
  { id: 38, name: 'Luxury Tax', type: 'tax', art: 'tax', taxLabel: 'Pay ₹1,00,000' },
  { id: 39, name: 'Jubilee', type: 'property', colorGroup: 'indigo', price: 400000 },
];

// Grid coordinates for the 40 space square board (11x11 grid)
export const BOARD_GRID = [
  // Position 0: Bottom-right corner
  [11, 11],

  // Positions 1-9: Bottom row, moving left
  [10, 11],
  [9, 11],
  [8, 11],
  [7, 11],
  [6, 11],
  [5, 11],
  [4, 11],
  [3, 11],
  [2, 11],

  // Position 10: Bottom-left corner
  [1, 11],

  // Positions 11-19: Left column, moving up
  [1, 10],
  [1, 9],
  [1, 8],
  [1, 7],
  [1, 6],
  [1, 5],
  [1, 4],
  [1, 3],
  [1, 2],

  // Position 20: Top-left corner
  [1, 1],

  // Positions 21-29: Top row, moving right
  [2, 1],
  [3, 1],
  [4, 1],
  [5, 1],
  [6, 1],
  [7, 1],
  [8, 1],
  [9, 1],
  [10, 1],

  // Position 30: Top-right corner
  [11, 1],

  // Positions 31-39: Right column, moving down
  [11, 2],
  [11, 3],
  [11, 4],
  [11, 5],
  [11, 6],
  [11, 7],
  [11, 8],
  [11, 9],
  [11, 10],
];
