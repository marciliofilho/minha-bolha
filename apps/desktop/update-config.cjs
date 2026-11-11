/**
 * Repositório usado para verificar e baixar atualizações.
 *
 * Quando o repositório for criado, troque `owner` e `repo` aqui. Este é o
 * único lugar necessário: o electron-builder e o updater leem este arquivo.
 */
module.exports = {
  owner: 'marciliofilho',
  repo: 'minha-bolha',
  get configured() {
    return this.owner !== 'SEU_USUARIO' && Boolean(this.repo);
  }
};
