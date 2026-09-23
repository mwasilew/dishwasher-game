/**
 * Twelve loads, in the order a week actually piles up on you.
 *
 * The ramp is in three dimensions at once: how many items, how awkward each one is,
 * and how tightly the total volume approaches what the two racks can actually hold.
 * By level 12 the machine is genuinely near capacity, and the order you load in
 * starts to matter as much as where things go.
 */
export const LEVELS = [
  {
    name: 'Just the breakfast things',
    blurb: 'Plates stand between the tines. Cups go up top, facing down.',
    hint: 'Anything that can hold water has to go face down, or it comes out full.',
    items: [
      ['dinner-plate', 4], ['cereal-bowl', 3], ['mug', 3],
      ['spoon', 3], ['teaspoon', 2],
    ],
  },
  {
    name: 'After dinner for four',
    blurb: 'A full table setting. Everything has an obvious home — for now.',
    hint: 'Slot the plates into the tine rows and keep the glasses in the upper rack.',
    items: [
      ['dinner-plate', 4], ['side-plate', 3], ['glass', 4],
      ['fork', 4], ['knife', 3], ['spoon', 3],
    ],
  },
  {
    name: 'Pasta night',
    blurb: 'The saucepan and the colander both want the same corner.',
    hint: 'Big round things eat the lower rack. Put them in first, then fit plates around them.',
    items: [
      ['colander', 1], ['ladle', 1], ['dinner-plate', 2], ['cereal-bowl', 3],
      ['glass', 3], ['fork', 4], ['spoon', 3],
    ],
  },
  {
    name: 'Sunday fry-up',
    blurb: 'A frying pan is mostly handle, and the handle has to go somewhere.',
    hint: 'Lay the pan face down and let the handle poke between the tine rows.',
    items: [
      ['frying-pan', 1], ['dinner-plate', 2], ['mug', 4],
      ['spatula', 1], ['tongs', 1], ['fork', 4], ['knife', 4],
    ],
  },
  {
    name: 'The cutlery drawer emptied itself',
    blurb: 'The basket holds a lot. It does not hold everything.',
    hint: 'Cutlery in the basket handle-down; long utensils can lie flat in the upper rack.',
    items: [
      ['fork', 4], ['knife', 3], ['spoon', 3], ['teaspoon', 2],
      ['ladle', 1], ['whisk', 1], ['spatula', 1], ['tongs', 1], ['peeler', 1],
      ['dinner-plate', 3], ['mug', 2],
    ],
  },
  {
    name: 'Baking day',
    blurb: 'Flat things want to be upright; upright things want to be flat.',
    hint: 'Trays and boards go down the sides or the very back, where they shade nothing.',
    items: [
      ['baking-tray', 1], ['cutting-board', 1], ['measuring-jug', 1],
      ['whisk', 1], ['spatula', 1], ['ramekin', 3], ['side-plate', 2],
      ['teaspoon', 4], ['mug', 2],
    ],
  },
  {
    name: 'The big pot',
    blurb: 'A stockpot and a casserole, and the lower rack only has one floor.',
    hint: 'Face down, side by side. Two big pans is all the bottom rack has room for.',
    items: [
      ['stockpot', 1], ['casserole-lid', 1], ['ladle', 1],
      ['dinner-plate', 1], ['cereal-bowl', 2], ['glass', 3], ['spoon', 4],
    ],
  },
  {
    name: 'Dinner party',
    blurb: 'Six wine glasses and nowhere sensible to put the platter.',
    hint: 'Wine glasses need headroom — nothing tall may share the upper rack with them.',
    items: [
      ['wine-glass', 5], ['platter', 1], ['salad-bowl', 1], ['dinner-plate', 1],
      ['espresso-cup', 3], ['saucer', 3],
      ['fork', 4], ['knife', 4], ['teaspoon', 3],
    ],
  },
  {
    name: 'The roast',
    blurb: 'A roasting tin the size of the rack, and it still has to come out clean.',
    hint: 'The arms spray upwards. A tin lying flat shields everything above it, so keep it low and to one side.',
    items: [
      ['roasting-tin', 1], ['platter', 1], ['dinner-plate', 2],
      ['glass', 3], ['fork', 4], ['knife', 3], ['spoon', 3], ['ladle', 1],
    ],
  },
  {
    name: 'Meal prep Sunday',
    blurb: 'Lids. So many lids. All of them lighter than the water hitting them.',
    hint: 'Light plastic goes in the upper rack, wedged under the tines so it cannot flip.',
    items: [
      ['tupperware', 3], ['tupperware-lid', 3], ['travel-mug', 1],
      ['mixing-bowl', 1], ['cutting-board', 1],
      ['spatula', 1], ['spoon', 4], ['fork', 4],
    ],
  },
  {
    name: 'Toddler aftermath',
    blurb: 'Nothing here is heavy, everything here is the wrong shape.',
    hint: 'Sippy cups and bottles all face down, and none of them can shelter the others.',
    items: [
      ['sippy-cup', 3], ['baby-bottle', 2], ['cereal-bowl', 2], ['side-plate', 3],
      ['ramekin', 2], ['teaspoon', 4], ['spoon', 3], ['tupperware', 1],
      ['tupperware-lid', 1], ['mug', 2],
    ],
  },
  {
    name: 'Christmas dinner',
    blurb: 'Everything you own, and one machine. Good luck.',
    hint: 'Load the lower rack from the back forwards, and leave the tine rows for last.',
    items: [
      ['stockpot', 1], ['casserole-lid', 1], ['platter', 1], ['dinner-plate', 1],
      ['wine-glass', 2], ['glass', 3], ['mug', 2], ['cereal-bowl', 1],
      ['fork', 3], ['knife', 3], ['spoon', 3], ['teaspoon', 2],
      ['ladle', 1], ['whisk', 1], ['spatula', 1],
    ],
  },
];

/** Flatten a level's item table into a queue of individual dish ids. */
export function levelQueue(level) {
  const out = [];
  for (const [id, n] of level.items) for (let i = 0; i < n; i++) out.push(id);
  return out;
}

export function levelItemCount(level) {
  return level.items.reduce((s, [, n]) => s + n, 0);
}
