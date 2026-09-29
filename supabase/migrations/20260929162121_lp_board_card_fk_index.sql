-- Covers both board_id and the composite (board_id,column_id) foreign keys.
create index lp_board_cards_board_column_idx
  on public.lp_board_cards(board_id,column_id,sort_order,id);
