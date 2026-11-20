import createTicketHandler, {
  createTicketTypeHandler,
  transferTicketHandler,
  closeTicketHandler,
  claimTicketHandler,
  priorityTicketHandler,
  pinTicketHandler,
  unclaimTicketHandler,
  reopenTicketHandler,
  deleteTicketHandler,
  deleteWithoutTranscriptHandler,
} from '../../../handlers/ticketButtons.js';

export default [
  createTicketHandler,
  createTicketTypeHandler,
  transferTicketHandler,
  closeTicketHandler,
  claimTicketHandler,
  priorityTicketHandler,
  pinTicketHandler,
  unclaimTicketHandler,
  reopenTicketHandler,
  deleteTicketHandler,
  deleteWithoutTranscriptHandler,
];