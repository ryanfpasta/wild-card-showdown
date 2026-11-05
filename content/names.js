// Random names for the "shuffle me" button.
const ADJ = ['Sneaky', 'Sir', 'Lady', 'Captain', 'Professor', 'Doctor', 'Grumpy', 'Sassy', 'Fancy', 'Wobbly', 'Mighty',
  'Sleepy', 'Cheeky', 'Spicy', 'Lucky', 'Shady', 'Jolly', 'Turbo', 'Royal', 'Secret', 'Baron', 'Mega', 'Dizzy', 'Slick'];
const NOUN = ['Walrus', 'Pickle', 'Noodle', 'Badger', 'Waffle', 'Llama', 'Pancake', 'Goose', 'Potato', 'Muffin', 'Weasel',
  'Penguin', 'Taco', 'Biscuit', 'Hamster', 'Nugget', 'Gecko', 'Turnip', 'Moose', 'Otter', 'Crumpet', 'Ferret', 'Yeti', 'Bagel'];
const FIXED = ['Captain Bluffbeard', 'Duchess Fibs', 'Lord Wildcard', 'The Card Shark', 'Agent Fib', 'Madame Bluff',
  'Count Doodle', 'Ace Ventura', 'Sir Lies-a-Lot', 'Fib Wizard', 'Jack of Hearts', 'Queen of Fibs', 'Big Cheese',
  'Detective Doodle', 'Dr. Shuffle', 'Pokerface Pete', 'Sneaky Walrus', 'Baron Bluffington'];

module.exports = function randomName(rand, taken) {
  const used = new Set((taken || []).map(s => s.toLowerCase()));
  for (let i = 0; i < 40; i++) {
    let n;
    if (rand(3) === 0) n = FIXED[rand(FIXED.length)];
    else n = ADJ[rand(ADJ.length)] + ' ' + NOUN[rand(NOUN.length)];
    if (n.length <= 18 && !used.has(n.toLowerCase())) return n;
  }
  return 'Player ' + (rand(900) + 100);
};
