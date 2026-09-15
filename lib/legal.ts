// Operator details shown on /terms and /privacy. Fill these in before public
// launch; the pages stay marked DRAFT while `contact` is empty.
export const OPERATOR = {
  name: 'Eyoel Lundberg',
  contact: 'eyoel.lundberg@gmail.com',
  country: 'Sweden',
  updated: '16 September 2026',
};
export const legalIsDraft = () => !OPERATOR.contact;
export const contactLine = () =>
  OPERATOR.contact ? `Contact: ${OPERATOR.contact}.` : 'A contact address will be published here before launch.';
