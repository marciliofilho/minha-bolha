/**
 * Repositório usado para verificar e baixar atualizações.
 *
 * O electron-builder e o updater leem este arquivo; é o único lugar
 * necessário para configurar owner/repo.
 */
module.exports = {
  owner: 'marciliofilho',
  repo: 'minha-bolha',
  get configured() {
    return Boolean(this.owner && this.repo);
  }
};
