const pairs = (arr) => arr.map(([value, label]) => ({ value, label }));

const PROPERTY_TYPES = pairs([
  ['self_contain', 'Self-contain'],
  ['single_room', 'Single room'],
  ['room_parlour', 'Room and parlour'],
  ['two_bedroom', '2-bedroom flat'],
  ['three_bedroom', '3-bedroom flat'],
  ['hostel', 'Hostel room']
]);

const AMENITIES = pairs([
  ['water', 'Running water'],
  ['borehole', 'Borehole water'],
  ['electricity', 'Electricity'],
  ['prepaid_meter', 'Prepaid meter'],
  ['band_a', 'Band A light'],
  ['generator', 'Generator'],
  ['security', 'Security'],
  ['cctv', 'CCTV'],
  ['fenced', 'Fenced compound'],
  ['interlocked', 'Interlocked compound'],
  ['parking', 'Parking'],
  ['tiled_floor', 'Tiled floor'],
  ['pop_ceiling', 'POP ceiling'],
  ['wardrobe', 'Wardrobe'],
  ['kitchen_cabinets', 'Kitchen cabinets'],
  ['balcony', 'Balcony']
]);

const FEE_LABELS = pairs([
  ['agent', 'Agent fee'],
  ['agreement', 'Agreement fee'],
  ['form', 'Form fee'],
  ['inspection', 'Inspection fee'],
  ['caution', 'Caution deposit'],
  ['legal', 'Legal fee'],
  ['service', 'Service charge'],
  ['other', 'Other charge']
]);

const FEE_PAYEES = pairs([
  ['agent', 'Agent'],
  ['landlord', 'Landlord'],
  ['oikres', 'Oikres']
]);

const UNIT_KINDS = pairs([
  ['whole_unit', 'Whole place'],
  ['private_room', 'Private room'],
  ['shared_room', 'Shared room (bed space)']
]);

const PERIODS = [
  { value: 'year', label: 'per year', yearlyFactor: 1 },
  { value: 'semester', label: 'per semester', yearlyFactor: 2 },
  { value: 'month', label: 'per month', yearlyFactor: 12 }
];

const GENDERS = pairs([
  ['any', 'Any gender'],
  ['male', 'Male only'],
  ['female', 'Female only']
]);

const SHARED_FACILITIES = pairs([
  ['kitchen', 'Kitchen'],
  ['bathroom', 'Bathroom'],
  ['toilet', 'Toilet'],
  ['living_room', 'Living room'],
  ['water_tank', 'Water tank'],
  ['generator', 'Generator']
]);

const REJECTION_REASONS = pairs([
  ['photos', 'Photos are unclear or do not show the property'],
  ['price', 'Price or charges look incorrect or incomplete'],
  ['info', 'Description or location is missing key details'],
  ['duplicate', 'This property is already listed'],
  ['contact', 'Contact details could not be confirmed'],
  ['other', 'Other (see note)']
]);

const REPORT_REASONS = pairs([
  ['wrong_price', 'The price or charges are wrong'],
  ['already_rented', 'It is already rented'],
  ['fraud', 'I suspect fraud or a fake listing'],
  ['wrong_info', 'Photos or details do not match'],
  ['other', 'Something else']
]);

const ID_TYPES = pairs([
  ['nin', 'NIN slip or card'],
  ['drivers_licence', "Driver's licence"],
  ['voters_card', "Voter's card"],
  ['passport', 'International passport']
]);

const MARKET_CATEGORIES = pairs([
  ['books', 'Books and notes'],
  ['phones', 'Phones and tablets'],
  ['computers', 'Laptops and computers'],
  ['electronics', 'Electronics and gadgets'],
  ['furniture', 'Furniture and bedding'],
  ['appliances', 'Kitchen and appliances'],
  ['fashion', 'Clothes, shoes and bags'],
  ['academic', 'Lab coats and school supplies'],
  ['sports', 'Sports and fitness'],
  ['other', 'Other']
]);

const MARKET_CONDITIONS = pairs([
  ['new', 'Brand new'],
  ['like_new', 'Like new'],
  ['used_good', 'Used, good'],
  ['used_fair', 'Used, fair']
]);

const MARKET_STATUS_LABELS = { pending: 'Pending review', live: 'Live', sold: 'Sold', hidden: 'Hidden', deleted: 'Deleted' };

const ITEM_REPORT_REASONS = pairs([
  ['fraud', 'I suspect fraud or a scam'],
  ['prohibited', 'This should not be sold here'],
  ['wrong_info', 'Photos or details do not match'],
  ['sold', 'It is already sold'],
  ['other', 'Something else']
]);

const USER_REPORT_REASONS = pairs([
  ['fraud', 'Scam or fraud'],
  ['fake', 'Fake account or pretending to be someone else'],
  ['harassment', 'Harassment or abuse'],
  ['other', 'Something else']
]);

const REVIEW_REPORT_REASONS = pairs([
  ['abusive', 'Abusive or offensive'],
  ['fake', 'Fake, paid for or not a real experience'],
  ['wrong_person', 'About the wrong person'],
  ['other', 'Something else']
]);

const BAN_REASONS = pairs([
  ['fraud', 'Fraud or scam'],
  ['fake_listings', 'Fake lodges or items'],
  ['harassment', 'Harassment or abuse'],
  ['impersonation', 'Fake account or impersonation'],
  ['other', 'Other (see note)']
]);

const LISTING_STATUS_LABELS = {
  draft: 'Draft',
  pending: 'Pending review',
  live: 'Live',
  needs_reconfirm: 'Needs reconfirmation',
  hidden: 'Hidden',
  rejected: 'Rejected',
  rented: 'Rented',
  suspended: 'Suspended',
  deleted: 'Deleted'
};

const PUBLIC_STATUSES = ['live', 'needs_reconfirm'];

const RULES = {
  reconfirmEveryDays: 14,
  hideAfterDays: 30,
  reportsToAutoHide: 3,
  idRetentionDays: 30,
  minPhotos: 3,
  maxPhotos: 12,
  marketMinPhotos: 1,
  marketMaxPhotos: 6,
  marketMaxActive: 30,
  marketExpireDays: 60,
  marketExpireWarnDays: 5,
  reviewMaxChars: 600,
  maxVideoMb: 50,
  maxPhotoMb: 8
};

module.exports = {
  PROPERTY_TYPES, AMENITIES, FEE_LABELS, FEE_PAYEES, UNIT_KINDS, PERIODS, GENDERS,
  SHARED_FACILITIES, REJECTION_REASONS, REPORT_REASONS, ID_TYPES,
  LISTING_STATUS_LABELS, PUBLIC_STATUSES, RULES,
  MARKET_CATEGORIES, MARKET_CONDITIONS, MARKET_STATUS_LABELS, ITEM_REPORT_REASONS, USER_REPORT_REASONS, REVIEW_REPORT_REASONS, BAN_REASONS
};
